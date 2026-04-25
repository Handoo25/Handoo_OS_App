/** Inventory_Controller.gs - API TITANIUM V3.3 (CLEAN & TURBO) */
var Inventory_Controller = {

  /**
   * Helper privado para control de licencias.
   */
  _checkAccess: function() {
    return true; // <--- ESTO DESBLOQUEA EL ACCESO PARA QUE LA PANTALLA NO SE QUEDE OSCURA
    if (!Module_Admin.checkAccess('FEAT_INVENTORY_FULL')) {
       console.warn("Acceso restringido, pero permitiendo lectura básica.");
    }
  },

  /**
   * LISTADO COMPLETO (Titanium Nativo)
   */
  listFormula: function() {
    this._checkAccess();
    try {
      // Titanium ya guarda los componentes dentro del JSON, no hay que buscar en otra tabla
      const formulas = _DB.get("DB_FORMULAS") || [];
      // 🛡️ PARCHE DE COMPATIBILIDAD: El Centro de Producción filtra por type === 'PREPARACION'
      return Response.success(formulas.map(f => ({
        ...f,
        type: f.type || 'PREPARACION'
      })));
    } catch (e) { return Response.error(e.message); }
  },

  /**
   * GUARDADO ATÓMICO (Documento JSON completo)
   */
  saveFormula: function(payload) {
    this._checkAccess();
    try {
      const fId = (payload.id && payload.id !== 'new') ? payload.id : _DB.getNextSequentialId("DB_FORMULAS", "FOR");
      
      // 1. Limpiamos los decimales de los ingredientes
      const cleanComponents = (payload.components || []).map(comp => ({
        ...comp,
        cantidad_bruta: parseFloat(String(comp.cantidad_bruta).replace(',', '.')) || 0,
        merma_perc: parseFloat(String(comp.merma_perc).replace(',', '.')) || 0
      })).filter(c => c.master_id !== "");

      // 2. Creamos el Documento MAESTRO con TODO dentro
      const formulaDoc = {
        id: fId,
        nombre: payload.nombre,
        master_link: payload.master_link || null,
        id_producto: payload.master_link || null, // 👈 Aseguramos compatibilidad
        pvp_canales: payload.pvp_canales || { local: 0, delivery: 0, takeaway: 0 },
        coste_pack: parseFloat(payload.coste_pack || 0),
        vida_util: parseFloat(payload.vida_util || 0), // 👈 ¡NUEVO! Días de vida útil
        comisiones: payload.comisiones || { takeaway: 0, delivery: 0 },
        margen_objetivo_perc: parseFloat(payload.margen_objetivo_perc || 30),
        components: cleanComponents, // 👈 ¡MAGIA! Los ingredientes se guardan DENTRO de la ficha
        updated_at: new Date().toISOString()
      };
      
      // 3. Guardamos la fórmula
      _DB.save("DB_FORMULAS", fId, formulaDoc);

      // 4. Sincronización con el Maestro (MASTERS)
      if (formulaDoc.master_link) {
        const masters = _DB.get("MASTERS") || [];
        const master = masters.find(m => m.id === formulaDoc.master_link);
        if (master) {
          master.components = cleanComponents; // Actualizamos escandallo
          master.vida_util = formulaDoc.vida_util; // 👈 Sincronizamos vida útil
          
          // 4.1 Sincronizamos Alérgenos
          const inheritedAllergens = new Set();
          cleanComponents.forEach(comp => {
            const ing = masters.find(m => m.id === comp.master_id);
            if (ing && ing.alergenos) {
              ing.alergenos.forEach(alg => inheritedAllergens.add(String(alg)));
            }
          });
          master.alergenos = Array.from(inheritedAllergens);
          
          master.updated_at = new Date().toISOString();
          _DB.save("MASTERS", master.id, master);
        }
      }
      
      SpreadsheetApp.flush();

      return Response.success(formulaDoc, "Ficha guardada y sincronizada con el catálogo.");
    } catch(e) { return Response.error("Error: " + e.message); }
  },

  /**
   * CÁLCULO RECURSIVO (Lee directamente de f.components)
   */
  _calculateRecursively: function(fId, allF, allM, depth = 0) {
    if (depth > 5) return this._zero();
    const f = allF.find(x => x.id === fId);
    if (!f) return this._zero();

    // Ya no buscamos en allI, los items están en f.components
    const items = f.components || [];
    let costRaw = 0; let costPack = 0;

    items.forEach(it => {
      const m = allM.find(master => master.id === it.master_id);
      if (!m) return;

      let p = parseFloat(m.last_purchase_price || 0);
      if (p === 0 && m.aliases && m.aliases.length > 0) {
          p = parseFloat(m.aliases[0].last_price || m.aliases[0].tariff_price || 0);
      }

      if (m.nature === 'PREP') {
        const sub = allF.find(x => x.master_link === m.id);
        if (sub) p = this._calculateRecursively(sub.id, allF, allM, depth + 1).coste_base_unitario;
      }

      const yieldDiv = 1 - (parseFloat(it.merma_perc || 0) / 100);
      const q = parseFloat(it.cantidad_bruta || 0) / (yieldDiv || 1);
      
      if (it.tipo_componente === 'SOPORTE') costPack += (q * p);
      else costRaw += (q * p);
    });

    const pvpL = (parseFloat(f.pvp_canales?.local) || 0) / 1.10;
    const pvpD = (parseFloat(f.pvp_canales?.delivery) || 0) / 1.10;
    const pvpT = (parseFloat(f.pvp_canales?.takeaway) || 0) / 1.10;
    
    const comD = parseFloat(f.comisiones?.delivery || 0) / 100;
    const comT = parseFloat(f.comisiones?.takeaway || 0) / 100;
    const totalPack = costPack + (parseFloat(f.coste_pack) || 0);

    return {
      coste_base_unitario: costRaw,
      coste_packaging: totalPack,
      margen_local: Admin_Controller.round(pvpL - costRaw - totalPack),
      margen_delivery: Admin_Controller.round((pvpD * (1 - comD)) - costRaw - totalPack),
      margen_takeaway: Admin_Controller.round((pvpT * (1 - comT)) - costRaw - totalPack),
      porcentaje_materia_prima: Admin_Controller.round((costRaw / (pvpL || 1)) * 100),
      status: ((costRaw / (pvpL || 1)) * 100) > (f.margen_objetivo_perc || 30) ? 'CRITICAL' : 'OPTIMAL'
    };
  },

  getBulkLiveCosts: function(payload) {
    this._checkAccess();
    try {
      const formulaIds = Array.isArray(payload) ? payload : (payload.formulaIds || []);
      if (formulaIds.length === 0) return Response.success({});

      const allMasters = _DB.get("MASTERS") || [];
      const allFormulas = _DB.get("DB_FORMULAS") || [];

      const results = {};
      // Llamamos al cálculo recursivo pasándole solo las fórmulas y los maestros
      formulaIds.forEach(id => {
        results[id] = this._calculateRecursively(id, allFormulas, allMasters);
      });

      return Response.success(results);
    } catch(e) { return Response.error(e.message); }
  },
  _zero: function() {
    return { coste_base_unitario: 0, coste_packaging: 0, margen_local: 0, margen_delivery: 0, status: 'UNKNOWN' };
  },

  /**
   * BLOQUE LOGÍSTICO (INGENIERÍA)
   */
  getMarketBestPrice: function(payload) {
    this._checkAccess();
    try {
      const masters = _DB.get("MASTERS") || [];
      const item = masters.find(m => m.id === payload.master_id);
      if (!item || !item.aliases || item.aliases.length === 0) return Response.success(null);
      const best = item.aliases.reduce((prev, curr) => {
        const pVal = parseFloat(prev.last_price || prev.tariff_price || 999999);
        const cVal = parseFloat(curr.last_price || curr.tariff_price || 999999);
        return (pVal < cVal) ? prev : curr;
      });
      const vendors = _DB.get("DB_VENDORS") || [];
      const vendor = vendors.find(v => v.id === best.vendor_id);
      best.vendor_name = vendor ? vendor.nombre_fiscal : 'Proveedor Desconocido';
      return Response.success(best);
    } catch(e) { return Response.error(e.message); }
  },

  get_unit_cost: function(productId, targetUnit) {
    this._checkAccess();
    try {
      const conversion = _DB.get("DB_UNIT_CONVERSIONS", productId);
      const product = _DB.get("MASTERS", productId);
      if (!product) return Response.error("Producto no encontrado.");

      const lastPrice = parseFloat(product.last_purchase_price || product.pvp || 0);
      
      if (!conversion || targetUnit === conversion.consume_unit) {
        return Response.success({ cost: lastPrice });
      }
      
      const costPerConsumeUnit = lastPrice / (conversion.conversion_factor || 1);
      return Response.success({ cost: costPerConsumeUnit });
    } catch (e) { return Response.error("ERROR CÁLCULO COSTE: " + e.message); }
  },

  get_stock_chain: function(payload) {
    this._checkAccess();
    try {
      const { productId, stockBase } = payload;
      const convs = _DB.get("DB_UNIT_CONVERSIONS") || {};
      let conv = Object.values(convs).find(c => c.product_id === productId);
      if (!conv) conv = Object.values(convs).find(c => c.product_id === null);
      if (!conv) return Response.success(stockBase + " UD");
      
      const buyQty = stockBase / conv.factor;
      return Response.success(`${buyQty} ${conv.buy_unit} (eq. ${stockBase} ${conv.consume_unit})`);
    } catch(e) { return Response.error(e.message); }
  },

  auditPriceChange: function(productId, newPrice, oldPrice) {
    this._checkAccess();
    try {
      const masters = _DB.get("MASTERS") || [];
      const product = masters.find(p => p.id === productId);
      if (!product) return;
      const volatility = parseFloat(product.max_volatility_perc || 3);
      const priceChange = ((newPrice - oldPrice) / oldPrice) * 100;

      if (priceChange > volatility) {
        const formulas = _DB.get("DB_FORMULAS") || [];
        
        formulas.forEach(formula => {
          if (formula.components && formula.components.some(i => i.master_id === productId)) {
            const allFormulas = _DB.get("DB_FORMULAS") || [];
            const allMasters = _DB.get("MASTERS") || [];
            const costs = this._calculateRecursively(formula.id, allFormulas, allMasters);
            const currentMarginPerc = (costs.margen_delivery / (parseFloat(formula.pvp_canales?.delivery) || 1)) * 100;

            if (currentMarginPerc < parseFloat(formula.margen_objetivo_perc || 0)) {
              _DB.save("DB_AUDIT_LOGS", Utilities.getUuid(), {
                msg: `⚠️ ALERTA RIESGO: El margen de [${formula.nombre}] en Delivery ha caído al ${currentMarginPerc.toFixed(1)}% por la subida de [${product.nombre}].`,
                type: 'MARGIN_RISK',
                timestamp: new Date().toISOString()
              });
            }
          }
        });
      }
    } catch(e) { console.error("Error en auditoría: " + e.message); }
  },

  /**
   * BLOQUE DE STOCK Y OPERATIVA
   */
  adjust_stock: function(payload) {
    this._checkAccess();
    try {
      let { producto_id, cantidad, tipo, unidad } = payload;
      if (tipo === 'RESTA') {
        // Handoo Titanium 2026: FIFO es obligatorio para mermas si hay lotes
        const prod = _DB.get("MASTERS").find(p => p.id === producto_id);
        if (!prod) return Response.error("Producto no encontrado.");
        
        if (prod.batches && prod.batches.length > 0) {
          if (!this.consumeStockFIFO(producto_id, cantidad)) {
             return Response.error("Stock insuficiente en lotes para aplicar FIFO.");
          }
        } else {
          // Fallback si no hay lotes (Stock simple)
          prod.stock = (parseFloat(prod.stock) || 0) - cantidad;
          _DB.save("MASTERS", prod.id, prod);
        }
      } else {
        const prod = _DB.get("MASTERS").find(p => p.id === producto_id);
        if (prod) {
          if (true) { // Handoo Titanium 2026: Lotes siempre activos
            if (!prod.batches) prod.batches = [];
            prod.batches.push({
              id: "BATCH-" + Date.now(),
              entry_date: new Date().toISOString(),
              expiry_date: payload.expiry_date || null,
              vendor_id: payload.vendor_id || null,
              qty: cantidad
            });
          }
          prod.stock = (parseFloat(prod.stock) || 0) + cantidad;
          _DB.save("MASTERS", prod.id, prod);
        } else {
          return Response.error("Producto no encontrado.");
        }
      }
      const id = "MOV-INV-" + Date.now();
      const movement = {
        id: id,
        producto_id: producto_id,
        cantidad: tipo === 'SUMA' ? cantidad : -cantidad,
        unidad: unidad,
        tipo: tipo,
        concepto: payload.concept || 'Ajuste Manual',
        fecha: new Date().toISOString(),
        is_inventory_adjustment: true
      };
      _DB.save("DB_MOVEMENTS", id, movement);
      return Response.success(null, "Stock ajustado y movimiento registrado.");
    } catch(e) { return Response.error(e.message); }
  },

  consumeStockFIFO: function(productId, qtyToConsume) {
    const prod = _DB.get("MASTERS").find(p => p.id === productId);
    if (!prod || !prod.batches || prod.batches.length === 0) return false;

    prod.batches.sort((a, b) => new Date(a.entry_date) - new Date(b.entry_date));
    let remaining = qtyToConsume;

    for (let i = 0; i < prod.batches.length && remaining > 0; i++) {
      if (prod.batches[i].qty >= remaining) {
        prod.batches[i].qty -= remaining;
        remaining = 0;
      } else {
        remaining -= prod.batches[i].qty;
        prod.batches[i].qty = 0;
      }
    }

    prod.batches = prod.batches.filter(b => b.qty > 0);
    prod.stock = prod.batches.reduce((sum, b) => sum + b.qty, 0);

    _DB.save("MASTERS", prod.id, prod);
    return remaining === 0;
  },

  save_shift: function(payload) {
    this._checkAccess();
    try {
      const { type, items } = payload;
      let allShifts = _DB.get("DB_SHIFTS") || [];
      if (!Array.isArray(allShifts)) allShifts = [allShifts];
      let currentShift;

      if (type === 'START') {
        const shiftId = "SHIFT-" + Date.now();
        currentShift = { 
          id: shiftId, 
          date: new Date().toISOString(), 
          start_items: items, 
          end_items: [], 
          status: 'IN_PROGRESS' 
        };
        _DB.save("DB_SHIFTS", shiftId, currentShift);
      } else if (type === 'END') {
        currentShift = [...allShifts].reverse().find(s => s.status === 'IN_PROGRESS');
        if (!currentShift) return Response.error("No se encontró ningún turno abierto.");
        
        currentShift.end_items = items;
        currentShift.status = 'CLOSED';
        
        items.forEach(it => {
          if (Math.abs(it.diff) > 0) {
            this.sendToQuarantine({
              producto_id: it.id,
              cantidad: it.diff,
              unidad: it.unit || 'uds',
              origin: 'CIERRE_TURNO',
              shift_id: currentShift.id
            });
          }
        });
        _DB.save("DB_SHIFTS", currentShift.id, currentShift);
      }
      
      return Response.success(currentShift, `Turno ${type === 'START' ? 'Iniciado' : 'Cerrado'} correctamente.`);
    } catch(e) { return Response.error(e.message); }
  },

  get_current_shift_items: function() {
    this._checkAccess();
    try {
      let allShifts = _DB.get("DB_SHIFTS") || [];
      if (!Array.isArray(allShifts)) allShifts = [allShifts];
      const currentShift = [...allShifts].reverse().find(s => s.status === 'IN_PROGRESS');
      
      if (!currentShift || !currentShift.start_items || currentShift.start_items.length === 0) {
        return Response.success([]);
      }
      
      return Response.success(currentShift.start_items.map(it => ({
        id: it.id || it.nombre,
        nombre: it.nombre,
        cantidad_inicial: it.qty,
        unidad: it.unit
      })));
    } catch(e) { return Response.error(e.message); }
  },

  save_plate_waste: function(payload) {
    try {
      const id = "WST-" + Date.now();
      const entry = {
        id: id,
        timestamp: new Date().toISOString(),
        fecha: new Date().toISOString().split('T')[0],
        sede_id: payload.locationId || 'GLOBAL',
        producto_id: payload.producto_id,
        cantidad: parseFloat(payload.cantidad || 0),
        unidad: payload.unidad || 'raciones',
        motivo: payload.motivo || 'SOBRA_PLATO',
        coste_estimado: this._calculateWasteCost(payload.producto_id, payload.cantidad),
        user: payload.user || 'STAFF_COCINA'
      };

      _DB.save("DB_PLATE_WASTE", id, entry);
      
      if (entry.coste_estimado > 50) {
        Admin_Controller._logAction("ALERTA_MERMA_CRITICA", `Merma de ${entry.cantidad} en ${entry.producto_id} con coste de ${entry.coste_estimado}€`);
      }

      return Response.success(entry, "Merma registrada en el Radar.");
    } catch(e) { return Response.error(e.message); }
  },

  _calculateWasteCost: function(id, qty) {
    const escandallos = _DB.get("DB_FORMULAS") || [];
    const receta = escandallos.find(r => r.id === id);
    return receta ? (parseFloat(receta.coste_racion) * qty) : 0;
  },

  get_stock_movements: function() {
    this._checkAccess();
    try {
      const movements = _DB.get("DB_MOVEMENTS") || [];
      const stockMovements = movements
        .filter(m => m.is_inventory_adjustment === true && m.producto_id)
        .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
      return Response.success(stockMovements);
    } catch(e) { return Response.error(e.message); }
  },

  get_kardex_logs: function() {
    this._checkAccess();
    try {
      const logs = _DB.get("DB_KARDEX_LOGS") || [];
      // Devolvemos todos los logs, que ya vienen con fecha y producto_nombre
      return Response.success(logs);
    } catch(e) { return Response.error(e.message); }
  },

  link_audit_photos: function(movementId, driveIds) {
    this._checkAccess();
    try {
      const movement = _DB.get("DB_MOVEMENTS", movementId);
      if (!movement) return Response.error("Movimiento no encontrado.");
      movement.audit_photos = driveIds;
      _DB.save("DB_MOVEMENTS", movementId, movement);
      return Response.success(null, "Fotos vinculadas.");
    } catch (e) { return Response.error(e.message); }
  },

  /**
   * BLOQUE DE MANTENIMIENTO
   */
  run_migration: function() {
    this._checkAccess();
    return Response.success(Module_Inventory.fix_missing_metadata());
  },

  getCatalog: function() {
    this._checkAccess();
    try {
      console.log("DEBUG: Inventory_Controller.getCatalog - _DB exists:", typeof _DB !== 'undefined');
      const all = _DB.get("MASTERS") || [];
      console.log("DEBUG: Inventory_Controller.getCatalog - MASTERS count:", all.length);
      const inventoryTypes = ['PRODUCT', 'RAW', 'SEMIFINISHED', 'FINAL_PRODUCT', 'SUPPLY'];
      
      // Obtenemos packs también de SETTINGS si existen
      const customPacks = Admin_Controller._getSafeSetting("CUSTOM_PACKS", []);
      const masterPacks = all.filter(m => m.type === 'PACK');
      
      const data = {
        products: all.filter(m => inventoryTypes.includes(m.type)),
        modules: all.filter(m => m.type === 'MODULE'),
        plans: all.filter(m => m.type === 'PLAN'),
        discounts: all.filter(m => m.type === 'DISCOUNT'),
        packs: [...masterPacks, ...customPacks]
      };
      // Devolvemos los datos puros
      return Response.success(data);
    } catch(e) { 
      console.error("DEBUG: Inventory_Controller.getCatalog - Error:", e.message);
      return Response.error(e.message); 
    }
  },

  saveMaster: function(payload) {
    this._checkAccess();
    try {
      const m = payload.master || payload;
      if (!m.type) return Response.error("Tipo de activo no definido.");

      if (!m.id || m.id === 'new') {
        const prefixes = { 'PRODUCT': 'PRO', 'MODULE': 'MOD', 'PLAN': 'PLA', 'DISCOUNT': 'DTO' };
        m.id = _DB.getNextSequentialId("MASTERS", prefixes[m.type] || 'INV');
        
        if (!m.ref_contable) {
          const root = m.pgc_root || '700';
          m.ref_contable = _DB.getNextSubAccount(root);
        }
      }

      m.updated_at = new Date().toISOString();
      _DB.save("MASTERS", m.id, m);
      SpreadsheetApp.flush();
      return Response.success(m, "Activo sincronizado correctamente.");
    } catch ( e ) { return Response.error("ERROR INVENTARIO: " + e.message); }
  },

  conciliate: function(payload) {
    this._checkAccess();
    try {
      const { masterId, vendorId, vendorRef, price, factor, format } = payload;
      const tables = ['DB_EXPENSES', 'DB_DELIVERY_NOTES'];
      tables.forEach(tableName => {
        const allDocs = _DB.get(tableName) || [];
        allDocs.forEach(doc => {
          if (String(doc.vendor_id) === String(vendorId) && doc.items) {
            let modified = false;
            doc.items.forEach(it => {
              if (it.needs_conciliation && String(it.vendor_ref || 'S/R').toUpperCase() === String(vendorRef).toUpperCase()) {
                it.needs_conciliation = false; 
                it.master_id = masterId; 
                it.conversion_factor = factor;
                it.vendor_format = format;
                modified = true;
              }
            });
            if (modified) {
              doc.needs_conciliation = doc.items.some(item => item.needs_conciliation === true);
              _DB.save(tableName, doc.id, doc);
            }
          }
        });
      });

      Module_Inventory.learnAlias(masterId, vendorId, vendorRef, price, factor, format);
      return Response.success(null, "Conciliación industrial y aprendizaje completados.");
    } catch(e) { return Response.error(e.message); }
  },

  getQuarantine: function() {
    this._checkAccess();
    try {
      const expenses = _DB.get("DB_EXPENSES") || [];
      const notes = _DB.get("DB_DELIVERY_NOTES") || [];
      return Response.success([...expenses, ...notes].filter(e => e.needs_conciliation === true));
    } catch(e) { return Response.error(e.message); }
  },

  getPredictiveAlerts: function() {
    this._checkAccess();
    try {
      const masters = _DB.get("MASTERS") || [];
      const demandFactor = this._getDemandFactor();
      const alerts = [];
      masters.filter(p => p.type === 'PRODUCT' || p.nature === 'RAW').forEach(prod => {
        const stockActual = parseFloat(prod.stock || 0);
        const consumoMedioDiario = parseFloat(prod.avg_daily_usage || 0);
        const consumoProyectado = consumoMedioDiario * demandFactor;
        
        const diasAutonomia = consumoProyectado > 0 ? (stockActual / consumoProyectado) : 99;

        if (diasAutonomia < 2 || stockActual < parseFloat(prod.safety_stock || 0)) {
          alerts.push({
            id: prod.id,
            nombre: prod.nombre,
            stock: stockActual,
            autonomia: Math.round(diasAutonomia * 10) / 10,
            riesgo: diasAutonomia < 1 ? 'CRITICAL' : 'WARNING',
            motivo: diasAutonomia < 1 ? 'Rotura inminente' : 'Bajo mínimos'
          });
        }
      });

      return Response.success(alerts);
    } catch(e) { return Response.error(e.message); }
  },

  _getDemandFactor: function() {
    let factor = 1.0;
    const events = _DB.get("DB_EVENTS") || [];
    const today = new Date().toISOString().split('T')[0];

    if (events.some(e => e.date === today && e.type === 'RACING_MATCH')) factor += 0.5;
    if (events.some(e => e.date === today && e.type === 'FOODIE_PEAK')) factor += 0.3;
    
    return factor;
  },

  process_stock_movement: function(productId, qty, unit) {
    this._checkAccess();
    try {
      const conversion = _DB.get("DB_UNIT_CONVERSIONS", productId);
      if (!conversion) return Response.success({ qty: qty, unit: unit });
      if (unit === conversion.buy_unit) {
        const convertedQty = qty * (conversion.conversion_factor || 1);
        return Response.success({ qty: convertedQty, unit: conversion.consume_unit });
      }
      return Response.success({ qty: qty, unit: unit });
    } catch (e) { return Response.error("ERROR MOVIMIENTO STOCK: " + e.message); }
  },

  save_conversion: function(payload) {
    this._checkAccess();
    try {
      let { id, product_id, buy_unit, consume_unit, factor } = payload;
      if (!product_id) return Response.error("product_id es obligatorio.");

      if (!id) id = "rule-" + Date.now();
      
      const conversion = {
        id: id,
        product_id: product_id,
        buy_unit: buy_unit,
        consume_unit: consume_unit,
        factor: parseFloat(factor) || 1,
        updated_at: new Date().toISOString()
      };
      
      _DB.save("DB_UNIT_CONVERSIONS", id, conversion);
      SpreadsheetApp.flush();
      return Response.success(conversion, "Regla de conversión guardada.");
    } catch (e) { return Response.error("ERROR CONVERSIÓN: " + e.message); }
  },

  get_all_conversions: function() {
    this._checkAccess();
    try {
      return Response.success(_DB.get("DB_UNIT_CONVERSIONS") || {});
    } catch(e) { return Response.error(e.message); }
  },

  saveTariff: function(payload) {
    this._checkAccess();
    try {
      const { vendor_id, items } = payload;
      let count = 0;
      const catalog = _DB.get("MASTERS") || [];
      items.forEach(row => {
        const ref = row.ref;
        const concept = String(row.concept).toUpperCase().trim();
        const price = parseFloat(String(row.price).replace(',', '.'));

        let master = catalog.find(m => m.nombre === concept);
        if(!master) {
          const res = this.saveMaster({ master: { nombre: concept, type: 'PRODUCT', pvp: price } });
          if(res.ok) master = res.data;
        }

        if (master && !isNaN(price)) {
          Module_Inventory.learnAlias(master.id, vendor_id, ref, price, 1, 'UNIDAD', true);
          count++;
        }
      });
      return Response.success(null, `${count} registros de tarifa sincronizados.`);
    } catch(e) { return Response.error(e.message); }
  },

  sendToQuarantine: function(payload) {
    this._checkAccess();
    const id = "QUA-" + Utilities.getUuid().substring(0,8);
    const quarantineItem = {
      id: id,
      producto_id: payload.producto_id,
      cantidad: payload.cantidad,
      unidad: payload.unidad,
      status: 'PENDING',
      origin: payload.origin,
      timestamp: new Date().toISOString(),
      shift_id: payload.shift_id
    };
    _DB.save("DB_QUARANTINE", id, quarantineItem);
  },

  resolveQuarantine: function(payload) {
    this._checkAccess();
    try {
      const { id, reason, comments } = payload; 
      const item = _DB.get("DB_QUARANTINE", id);
      if (!item) return Response.error("Registro no encontrado.");

      if (reason !== 'ERROR_CONTEO') {
        this.adjust_stock({
          producto_id: item.producto_id,
          cantidad: Math.abs(item.cantidad),
          tipo: 'RESTA',
          unidad: item.unidad,
          concept: `[QUARANTINE] ${reason}: ${comments || ''}`
        });
      }

      item.status = 'RESOLVED';
      item.reason = reason;
      item.resolved_at = new Date().toISOString();
      _DB.save("DB_QUARANTINE", id, item);

      return Response.success(null, "Incidente resuelto.");
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * CHEMINAI - INTERFAZ ESTRATÉGICA
   */
  handle_cheminai_intent: function(payload) {
    this._checkAccess();
    try {
      const { intent, params } = payload;
      
      if (intent === 'UNIT_CONV') {
        return this.save_conversion({
          product_id: params.product_id,
          buy_unit: params.buy_unit,
          consume_unit: params.consume_unit,
          factor: params.factor
        });
      } else if (intent === 'INV_AJUSTE') {
        return this.adjust_stock({
          producto_id: params.producto_id,
          cantidad: params.cantidad,
          tipo: params.tipo,
          unidad: params.unidad || 'uds',
          concept: params.concept || 'Ajuste CHEMINAI'
        });
      } else if (intent === 'WASTE_REG') {
        return this.adjust_stock({
          producto_id: params.producto_id,
          cantidad: params.cantidad,
          tipo: 'RESTA',
          unidad: params.unidad || 'g',
          concept: params.concept || 'Merma CHEMINAI'
        });
      }
      
      return Response.error("Intento no reconocido.");
    } catch(e) { return Response.error("Error CHEMINAI: " + e.message); }
  },

  /**
   * ELIMINACIÓN SEGURA (HACIA EL AGUJERO NEGRO / PAPELERA)
   */
  deleteMaster: function(payload) {
    this._checkAccess();
    try {
      if (!payload.id) return Response.error("ID requerido para eliminar.");

      // Blindaje: Verificamos si hay stock antes de permitir borrarlo
      const masters = _DB.get("MASTERS") || [];
      const master = masters.find(m => m.id === payload.id);
      
      if (master && (parseFloat(master.stock) > 0 || parseFloat(master.stock_actual) > 0)) {
        return Response.error("Integridad protegida: No se puede eliminar un artículo que tiene stock contable positivo. Ajuste el stock a 0 primero.");
      }

      // Enviamos a la papelera en lugar de destrucción total
      const ok = _DB.moveToTrash("MASTERS", payload.id);
      
      return ok ? Response.success(null, "Artículo movido a la papelera correctamente.") : Response.error("Fallo al mover a la papelera en el Kernel.");
    } catch(e) { 
      return Response.error(e.message); 
    }
  },

  register_waste_classified: function(p) {
    try {
      const wasteId = _DB.getNextSequentialId("DB_WASTE_LOGS", "WST");
      
      const record = {
        id: wasteId,
        producto_id: p.producto_id,
        tipo: p.tipo, // INVENTARIO, FRESCO, ARRASTRE, PLATO
        cantidad: parseFloat(p.cantidad),
        motivo: p.motivo,
        fecha: new Date().toISOString(),
        usuario: p.usuario || 'Admin'
      };
      
      _DB.save("DB_WASTE_LOGS", wasteId, record);

      // ⚠️ LÓGICA DE INVENTARIO:
      // Si es PLATO, no restamos nada (ya se restó al vender).
      // Si es el resto, restamos la cantidad del producto indicado.
      if (p.tipo !== 'PLATO') {
          Inventory_Controller.adjust_stock({
              producto_id: p.producto_id,
              cantidad: parseFloat(p.cantidad),
              tipo: 'RESTA',
              concept: `MERMA (${p.tipo}): ${p.motivo}`
          });
      }

      return Response.success(record, "Merma registrada correctamente.");
    } catch(e) { return Response.error(e.message); }
  },

  deleteFormula: function(payload) {
    this._checkAccess();
    try {
      if (!payload.id) return Response.error("ID requerido para eliminar.");
      
      const ok = _DB.moveToTrash("DB_FORMULAS", payload.id);
      
      return ok ? Response.success(null, "Escandallo/Fórmula movida a la papelera correctamente.") : Response.error("Fallo al mover a la papelera en el Kernel.");
    } catch(e) { 
      return Response.error(e.message); 
    }
  }
};