/**
 * Module_Inventory.gs - TITANIUM CATALOG BRAIN V1.2 (INDUSTRIAL ENGINE)
 */
var Module_Inventory = {

  /**
   * Identifies an internal product from a vendor's reference.
   * If not found, marks for Quarantine.
   */
  resolveInternalProduct: function(vendorId, vendorRef) {
    const masters = _DB.get("MASTERS");
    const normalizedRef = String(vendorRef).trim().toUpperCase();
    
    // Search in aliases of all products/modules
    for (const item of masters) {
      if (!item.aliases) continue;
      const match = item.aliases.find(a => 
        String(a.vendor_id) === String(vendorId) && 
        String(a.vendor_ref).toUpperCase() === normalizedRef
      );
      if (match) return item;
    }
    
    return null; // Triggers Quarantine Flow
  },

  /**
   * Creates a permanent link between a vendor's text and an internal Master ID.
   */
  learnAlias: function(masterId, vendorId, vendorRef, price, factor = 1, format = 'CAJA', isTariff = false) {
    const masters = _DB.get("MASTERS");
    const item = masters.find(m => m.id === masterId);
    
    if (item) {
      if (!item.aliases) item.aliases = [];
      
      const normalizedRef = String(vendorRef || 'S/R').trim().toUpperCase();
      
      // Update or Add
      const existingIdx = item.aliases.findIndex(a => String(a.vendor_id) === String(vendorId) && String(a.vendor_ref) === normalizedRef);
      
      const aliasData = existingIdx > -1 ? item.aliases[existingIdx] : {
        vendor_id: vendorId,
        vendor_ref: normalizedRef
      };

      if (isTariff) {
         aliasData.tariff_price = parseFloat(price || 0);
      } else {
         aliasData.last_price = parseFloat(price || 0);
      }

      aliasData.conversion_factor = parseFloat(factor || 1);
      aliasData.vendor_format = String(format || 'CAJA').toUpperCase();
      aliasData.updated_at = new Date().toISOString();

      if (existingIdx === -1) {
        item.aliases.push(aliasData);
      }
      
      _DB.save("MASTERS", item.id, item);
      return true;
    }
    return false;
  },

  /**
   * ALGORITMO PREDICTIVO V1.2 (ZERO-STOCK ENGINE)
   */
  calculateStockLevels: function() {
    const masters = _DB.get("MASTERS").filter(m => m.type === 'PRODUCT');
    const expenses = _DB.get("DB_EXPENSES") || [];
    const notes = _DB.get("DB_DELIVERY_NOTES") || [];
    const agoraSales = _DB.get("DB_INVOICES").filter(i => i.created_by === 'AGORA_WEBHOOK');
    
    const today = new Date();
    const last14Days = new Date(); last14Days.setDate(today.getDate() - 14);

    const alerts = [];

    masters.forEach(m => {
       let totalPurchased = 0;
       [...expenses, ...notes].forEach(doc => {
          doc.items?.forEach(it => {
             if (String(it.master_id) === String(m.id)) {
                const factor = parseFloat(it.conversion_factor || 1);
                totalPurchased += (parseFloat(it.qty) * factor);
             }
          });
       });

       let totalSold = 0;
       agoraSales.forEach(inv => {
          if (inv.item_display_name.includes(m.nombre)) totalSold += 1;
       });

       const currentStock = totalPurchased - totalSold;
       const recentSales = agoraSales.filter(i => new Date(i.fecha) >= last14Days);
       const consumptionPerDay = recentSales.length / 14; 

       const leadTime = parseInt(m.lead_time || 2);
       const safetyStock = parseFloat(m.safety_stock || 0);
       const criticalLevel = (consumptionPerDay * leadTime) + safetyStock;

       if (currentStock <= criticalLevel && consumptionPerDay > 0) {
          const daysLeft = Math.floor(currentStock / consumptionPerDay);
          alerts.push({
             id: m.id,
             name: m.nombre,
             stock: currentStock,
             velocity: consumptionPerDay,
             days_left: daysLeft,
             lead_time: leadTime,
             safety_stock: safetyStock,
             is_critical: daysLeft <= leadTime
          });
       }
    });

    return alerts;
  },

  getPlanComposition: function(planId) {
    const masters = _DB.get("MASTERS");
    const plan = masters.find(m => m.id === planId && m.type === 'PLAN');
    if (!plan) return null;
    
    const modules = (plan.module_ids || []).map(mid => masters.find(m => m.id === mid)).filter(Boolean);
    return { ...plan, modules };
  },

  get_batches: function(productId) {
    const masters = _DB.get("MASTERS");
    const item = masters.find(m => m.id === productId);
    if (!item || !item.batches) return [];
    
    return item.batches.filter(b => b.qty > 0).map(b => ({
      id: b.id,
      qty: b.qty,
      expiry_date: b.expiry_date || null
    }));
  },

  getCatalog: function() {
    const masters = _DB.get("MASTERS") || [];
    
    // Preparamos el objeto con las "carpetas" que espera el Frontend
    const catalog = {
      products: [],
      modules: [],
      plans: [],
      discounts: []
    };

    masters.forEach(m => {
      // Normalizamos alérgenos
      let alData = m.alergenos || [];
      if (typeof alData === 'string') {
        try { alData = JSON.parse(alData); } catch (e) { alData = []; }
      }
      m.alergenos = Array.isArray(alData) ? alData : [];

      // Clasificamos según el tipo para que la App los encuentre
      if (m.type === 'PRODUCT' || m.type === 'VENTA_FINAL' || m.type === 'MATERIA_PRIMA') {
        catalog.products.push(m);
      } else if (m.type === 'MODULE') {
        catalog.modules.push(m);
      } else if (m.type === 'PLAN') {
        catalog.plans.push(m);
      } else if (m.type === 'DISCOUNT') {
        catalog.discounts.push(m);
      }
    });

    return catalog; // Ahora enviamos las "carpetas" organizadas
  },

  /**
   * STOCK FIFO REAL (Lógica de lotes)
   */
  adjustStock: function(data) {
    const masters = _DB.get("MASTERS");
    const item = masters.find(m => m.id === data.producto_id);
    if (!item) return { ok: false, msg: "Producto no encontrado" };

    if (!item.batches) item.batches = [];
    const qty = parseFloat(data.cantidad);
    
    if (data.tipo === 'SUMA') {
      // Añadir lote
      item.batches.push({
        id: "BATCH-" + Date.now(),
        qty: qty,
        cost: data.cost || 0,
        date: new Date().toISOString()
      });
    } else if (data.tipo === 'RESTA') {
      // Consumir FIFO
      let remainingToConsume = qty;
      item.batches.sort((a, b) => new Date(a.date) - new Date(b.date));
      
      for (let i = 0; i < item.batches.length && remainingToConsume > 0; i++) {
        if (item.batches[i].qty >= remainingToConsume) {
          item.batches[i].qty -= remainingToConsume;
          remainingToConsume = 0;
        } else {
          remainingToConsume -= item.batches[i].qty;
          item.batches[i].qty = 0;
        }
      }
      // Limpiar lotes vacíos
      item.batches = item.batches.filter(b => b.qty > 0);
    }
    
    item.stock = item.batches.reduce((sum, b) => sum + b.qty, 0);
    _DB.save("MASTERS", item.id, item);

    const movement = {
      id: "MOV-" + Date.now(),
      producto_id: data.producto_id,
      cantidad: qty,
      tipo: data.tipo,
      unidad: data.unidad,
      concept: data.concept,
      date: new Date().toISOString()
    };
    _DB.save("DB_MOVEMENTS", movement.id, movement);

    return { ok: true, msg: "Stock ajustado FIFO", nuevo_stock: item.stock };
  },

  /**
   * COSTES INDUSTRIALES (Recursión + Merma)
   */
  getLiveCost: function(masterId) {
    const masters = _DB.get("MASTERS");
    const item = masters.find(m => m.id === masterId);
    if (!item) return { cost_base: 0, local: 0, takeaway: 0, delivery: 0 };

    let costBase = 0;
    if (item.nature === 'PREP' && item.master_link) {
      item.master_link.forEach(ing => {
        const ingItem = masters.find(m => m.id === ing.id);
        const merma = ingItem ? (ingItem.merma || 0) : 0;
        const cantidadBruta = ing.qty;
        // cantidad_real = cantidad_bruta / (1 - (merma / 100))
        const cantidadReal = cantidadBruta / (1 - (merma / 100));
        
        const ingCost = this.getLiveCost(ing.id);
        costBase += (ingCost.cost_base * cantidadReal);
      });
    } else {
      costBase = item.cost_base || 0;
    }

    // Márgenes Reales
    const pvpLocal = item.pvp_local || 0;
    const pvpTakeaway = item.pvp_takeaway || 0;
    const pvpDelivery = item.pvp_delivery || 0;
    const costEnvase = item.cost_envase || 0;
    const comisionApp = item.comision_app || 0;

    return {
      cost_base: costBase,
      local: pvpLocal - costBase,
      takeaway: pvpTakeaway - costBase - costEnvase,
      delivery: pvpDelivery - costBase - costEnvase - comisionApp
    };
  },

  fix_missing_metadata: function() {
    const masters = _DB.get("MASTERS") || [];
    let updatedCount = 0;
    masters.forEach(m => {
      if (!m.nature) {
        m.nature = "RAW";
        _DB.save("MASTERS", m.id, m);
        updatedCount++;
      }
    });
    return `Metadata reparada en ${updatedCount} productos.`;
  },

  save_master: function(payload) {
    if (!payload.id) return { ok: false, msg: "ID no proporcionado" };

    const masters = _DB.get("MASTERS") || [];
    // Limpiamos espacios en blanco por si el formulario los envía por error
    const searchId = String(payload.id).trim(); 
    const existing = masters.find(m => String(m.id).trim() === searchId);
    
    let finalData;

    if (existing) {
      // 1. CLONAMOS el Excel: Esta es la única verdad absoluta
      finalData = JSON.parse(JSON.stringify(existing));
      
      // 2. ACTUALIZAMOS solo lo que venga en el formulario y tenga sentido
      Object.keys(payload).forEach(key => {
         const value = payload[key];
         // Aceptamos arrays (alérgenos), números y textos reales (que no sean "null" ni vacíos)
         if (value !== undefined && value !== null && value !== "" && value !== "null") {
             finalData[key] = value;
         }
      });

      // 🚨 3. REGLA DE ORO (BLINDAJE ANTI-DESAPARICIÓN) 🚨
      // Si el formulario ha mandado basura al 'type', lo restauramos.
      const validTypes = ['PRODUCT', 'FINAL_PRODUCT', 'MATERIA_PRIMA', 'SERVICE', 'PLAN', 'MODULE'];
      if (!validTypes.includes(finalData.type)) {
          finalData.type = existing.type || 'PRODUCT';
      }
      
      // Mismo blindaje para el nombre, por si el formulario lo manda en blanco
      if (!finalData.nombre || finalData.nombre.trim() === "") {
          finalData.nombre = existing.nombre;
      }

    } else {
      // Si es nuevo de verdad
      finalData = payload;
      if (!finalData.type) finalData.type = 'PRODUCT';
    }

    // 4. GUARDADO DE ALÉRGENOS EN FORMATO TEXTO (Para el Excel)
    if (finalData.alergenos && Array.isArray(finalData.alergenos)) {
      finalData.alergenos = JSON.stringify(finalData.alergenos);
    }
    
    finalData.updated_at = new Date().toISOString();

    // 5. EJECUCIÓN DEL GUARDADO
    _DB.save("MASTERS", searchId, finalData);
    
    return { ok: true, msg: "Sincronización hiper-blindada completada", data: finalData };
  },

  register_plate_waste: function(plato_id, cantidad_mermada, motivo, usuario) {
    const masters = _DB.get("MASTERS");
    const plato = masters.find(m => m.id === plato_id);
    if (!plato) throw new Error("Plato no encontrado");
    if (!plato.bom) throw new Error("El plato no tiene escandallo (BOM)");

    let totalCosteDescontado = 0;

    plato.bom.forEach(ing => {
      const cantidadARestar = ing.qty * cantidad_mermada;
      const res = this.adjustStock({
        producto_id: ing.id,
        cantidad: cantidadARestar,
        tipo: 'RESTA',
        unidad: 'g',
        concept: 'Merma: ' + plato.nombre
      });
      
      if (res.ok) {
        const ingMaster = masters.find(m => m.id === ing.id);
        if (ingMaster && ingMaster.last_cost) {
          totalCosteDescontado += (ingMaster.last_cost * cantidadARestar);
        }
      }
    });

    const mermaRecord = {
      plato_id: plato_id,
      plato_nombre: plato.nombre,
      cantidad: cantidad_mermada,
      motivo: motivo,
      usuario: usuario,
      coste_descontado: totalCosteDescontado,
      date: new Date().toISOString()
    };
    _DB.save("DB_WASTE", "WASTE-" + Date.now(), mermaRecord);

    return { ok: true, msg: "Merma registrada. Coste descontado: " + totalCosteDescontado };
  },

  savePlateWaste: function(payload) {
    return this.register_plate_waste(payload.producto_id, payload.cantidad, payload.concept || "Merma generada", "Usuario Activo");
  },

  getPerformanceReport: function() {
    const masters = _DB.get("MASTERS") || [];
    const sales = _DB.get("DB_INVOICES") || [];
    const products = masters.filter(m => m.type === 'VENTA_FINAL');

    // 1. Cálculo de métricas
    const report = products.map(p => {
      const volume = sales.filter(s => s.item_id === p.id).length;
      const margin = parseFloat(p.pvp || 0) - parseFloat(p.last_cost || 0);
      return { id: p.id, name: p.nombre, volume, margin, margin_percent: p.pvp > 0 ? (margin/p.pvp)*100 : 0 };
    });

    // 2. Medias del local
    const avgVol = report.reduce((sum, p) => sum + p.volume, 0) / (report.length || 1);
    const avgMarg = report.reduce((sum, p) => sum + p.margin, 0) / (report.length || 1);

    // 3. Clasificación BCG
    const classified = report.map(p => {
      let bcg = 'PERRO';
      if (p.volume >= avgVol && p.margin >= avgMarg) bcg = 'ESTRELLA';
      else if (p.volume < avgVol && p.margin >= avgMarg) bcg = 'ENIGMA';
      else if (p.volume >= avgVol && p.margin < avgMarg) bcg = 'CABALLO';
      return { ...p, bcg };
    });

    return { 
      products: classified, 
      averages: { volume: avgVol, margin: avgMarg },
      fiscal_shield: { monthly_saving: 0, annual_saving: 0 } // Pendiente conectar con Fixed Assets
    };
  }
};

/**
 * PUENTES GLOBALES TITANIUM
 */
function TITANIUM_save_shift(payload) {
  if (payload.type === 'DELETE' && payload.shift_id) {
     _DB.save("DB_SHIFTS", payload.shift_id, null);
     _DB.save("DB_SHIFTS", "undefined", null); 
     return {ok: true, msg: "Registro eliminado."};
  }
  
  if (payload.type === 'END' && payload.shift_id) {
     let allShifts = _DB.get("DB_SHIFTS") || [];
     if (!Array.isArray(allShifts)) allShifts = Object.values(allShifts);
     
     let currentShift = allShifts.find(s => s.id === payload.shift_id);
     if (!currentShift) return {ok: false, msg: "Turno no encontrado"};
     
     currentShift.end_items = payload.items;
     currentShift.status = 'CLOSED';
     
     payload.items.forEach(it => {
         if (it.diff > 0) Module_Inventory.adjustStock({ producto_id: it.id, cantidad: it.diff, tipo: 'RESTA', unidad: it.unit || 'uds', concept: 'Descuadre Cierre Turno' });
     });
     _DB.save("DB_SHIFTS", currentShift.id, currentShift);
     return {ok: true, data: currentShift, msg: "Turno cerrado correctamente."};
  }
  
  if (payload.type === 'ADD_STOCK' && payload.shift_id) {
     let allShifts = _DB.get("DB_SHIFTS") || [];
     if (!Array.isArray(allShifts)) allShifts = Object.values(allShifts);
     let currentShift = allShifts.find(s => s.id === payload.shift_id);
     if (!currentShift) return {ok: false, msg: "Turno no encontrado"};
     
     payload.items.forEach(newItem => {
         const existing = currentShift.start_items.find(i => i.id === newItem.id);
         if(existing) { existing.qty += newItem.qty; } else { currentShift.start_items.push(newItem); }
     });
     
     _DB.save("DB_SHIFTS", currentShift.id, currentShift);
     return {ok: true, msg: "Stock extra sumado al turno."};
  }

  if (payload.type === 'START') {
     const shiftId = "SHIFT-" + Date.now();
     const currentShift = { 
         id: shiftId, 
         date: new Date().toISOString(), 
         shift_type: payload.shift_type || 'GENERAL',
         start_items: payload.items, 
         end_items: [], 
         status: 'IN_PROGRESS' 
     };
     _DB.save("DB_SHIFTS", shiftId, currentShift);
     return {ok: true, data: currentShift, msg: "Turno " + currentShift.shift_type + " iniciado."};
  }
  
  return {ok: false, msg: "Operación no reconocida."};
}

function TITANIUM_get_current_shift_items(shiftId = null) {
  let allShifts = _DB.get("DB_SHIFTS") || [];
  if (!Array.isArray(allShifts)) allShifts = Object.values(allShifts);
  
  let currentShift;
  if (shiftId) {
      currentShift = allShifts.find(s => s.id === shiftId);
  } else {
      currentShift = [...allShifts].reverse().find(s => s.status === 'IN_PROGRESS');
  }
  
  if (!currentShift || !currentShift.start_items) return { ok: true, data: [] };
  return { ok: true, data: currentShift.start_items.map(it => ({
      id: it.id || it.nombre,
      nombre: it.nombre,
      cantidad_inicial: it.qty,
      unidad: it.unit
  }))};
}

function TITANIUM_get_all_shifts() {
  try {
    let shifts = _DB.get("DB_SHIFTS") || [];
    if (!Array.isArray(shifts)) shifts = Object.values(shifts);
    const validShifts = shifts.filter(s => s && s.id && s.id !== "undefined" && s.id !== "null");
    return { ok: true, data: validShifts.sort((a,b) => new Date(b.date) - new Date(a.date)) };
  } catch(e) { 
    return { ok: false, msg: e.message }; 
  }
}

function TITANIUM_save_shift_types(shiftTypes) {
  try {
    const doc = { id: "CONF_SHIFTS", type: "CONFIG", shift_types: shiftTypes };
    _DB.save("MASTERS", doc.id, doc);
    return { ok: true, msg: "Operativa Sincronizada" };
  } catch(e) { return { ok: false, msg: e.message }; }
}

function TITANIUM_get_shift_types() {
  try {
    let allMasters = _DB.get("MASTERS") || [];
    if (!Array.isArray(allMasters)) allMasters = Object.values(allMasters);
    const doc = allMasters.find(m => m.id === "CONF_SHIFTS");
    return { ok: true, data: (doc && doc.shift_types) ? doc.shift_types : null };
  } catch(e) { return { ok: false, msg: e.message }; }
}

function TITANIUM_delete_shift_force(shiftId) {
  try {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    const allShifts = _DB.get("DB_SHIFTS") || [];
    const shiftsArray = Array.isArray(allShifts) ? allShifts : Object.values(allShifts);
    const shiftToTrash = shiftsArray.find(s => s.id === shiftId);
    
    if (shiftToTrash) {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        let trashSheet = ss.getSheetByName("RECYCLE_BIN");
        if (!trashSheet) {
            trashSheet = ss.insertSheet("RECYCLE_BIN");
            trashSheet.appendRow(["ID", "JSON_DATA", "METADATA", "ORIGIN_SHEET", "DELETED_AT"]);
            trashSheet.setFrozenRows(1);
        }
        const userEmail = Session.getActiveUser().getEmail() || "Usuario Activo";
        const metadata = { reason: "Purga Manual Auditoría", user: userEmail };
        trashSheet.appendRow([shiftId, JSON.stringify(shiftToTrash), JSON.stringify(metadata), "DB_SHIFTS", new Date().toISOString()]);
    }
    _DB.save("DB_SHIFTS", shiftId, null);
    lock.releaseLock();
    return { ok: true, msg: "Turno enviado a la papelera con éxito." };
  } catch(e) { 
    return { ok: false, msg: "Error en purga: " + e.message }; 
  }
}

function TITANIUM_EXORCISM() {
  let shifts = _DB.get("DB_SHIFTS") || [];
  let arr = Array.isArray(shifts) ? shifts : Object.values(shifts);
  let purgas = 0;
  arr.forEach(s => {
    if (!s || !s.id || String(s.id) === "undefined" || !String(s.id).startsWith("SHIFT-")) {
      _DB.save("DB_SHIFTS", s.id || "undefined", null);
      purgas++;
    }
  });
  return purgas + " fantasmas eliminados.";
}

function TITANIUM_NUCLEAR_EXORCISM() {
  let db = _DB.get("DB_SHIFTS");
  let count = 0;
  for (let key in db) {
    let turno = db[key];
    if (!turno || !turno.id || !String(turno.id).startsWith("SHIFT-") || key === "undefined" || key === "null") {
      _DB.save("DB_SHIFTS", key, null);
      count++;
    }
  }
  console.log("FUEGO NUCLEAR COMPLETADO: " + count + " anomalías desintegradas.");
}

/**
 * PUENTES GLOBALES API
 */
function api_inventory_save_master(payload) {
  return Module_Inventory.save_master(payload);
}

function api_inventory_register_waste(plato_id, cantidad, motivo) {
  const usuario = Session.getActiveUser().getEmail() || "Usuario Activo";
  return Module_Inventory.register_plate_waste(plato_id, cantidad, motivo, usuario);
}

function api_admin_get_performance_report() {
  return Module_Inventory.getPerformanceReport();
}