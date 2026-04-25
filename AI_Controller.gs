/**
 * AI_Controller.gs - TITANIUM NEURAL BRIDGE V1.8.0 (Chemin AI CFO)
 */

var AI_Controller = {

  /**
   * MÉTODO: Generador del Data Lake para Chemin AI
   */
  getAIContext: function(locationId) {
    try {
      const settings = Admin_Controller.getSettings().data;
      const activeModules = settings.active_modules || [];
      const isGlobal = !locationId || locationId === 'GLOBAL';
      
      // 1. EL GUARDIÁN: Control de Licencias
      const hasInventoryAccess = activeModules.includes('FEAT_INVENTORY_ADVANCED') || 
                                 activeModules.includes('FEAT_INVENTORY_RECIPES') ||
                                 activeModules.includes('FEAT_INVENTORY_FULL') || 
                                 activeModules.includes('FEAT_FORMULAS');
      
      // 2. EL DATA LAKE (Contexto para el Oráculo)
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];

      // Datos Crudos
      const allEffects = _DB.get("DB_EFFECTS") || [];
      const allInvoices = _DB.get("DB_INVOICES") || [];
      const expenseOrders = _DB.get("DB_EXPENSE_ORDERS") || [];
      const masters = _DB.get("MASTERS") || [];
      const events = _DB.get("DB_EVENTS") || [];
      const formulas = _DB.get("DB_FORMULAS") || [];

      // 2. FILTRADO QUIRÚRGICO POR SEDE
      const invoices = isGlobal ? allInvoices : allInvoices.filter(i => i.location_id === locationId);
      const effects = isGlobal ? allEffects : allEffects.filter(e => e.location_id === locationId);

      // 3. CLIMA DINÁMICO
      // Buscamos la ciudad: 1. En el perfil, 2. En el objeto raíz, 3. Por defecto Santander
      let ciudadEmpresa = settings.profile?.pob || settings.pob || settings.poblacion || "Santander";

      if (!isGlobal) {
        const local = masters.find(m => m.id === locationId);
        if (local && (local.pob || local.poblacion)) {
          ciudadEmpresa = local.pob || local.poblacion;
        }
      }

      const context = { 
        ciudad_actual: ciudadEmpresa.toUpperCase(),
        empresa: settings.profile?.nombre || 'Empresa Cliente',
        location_name: isGlobal ? "Global" : masters.find(m => m.id === locationId)?.nombre,
        timestamp: today.toISOString(),
        tesoreria_deuda_15d: this._calculateDebt(effects),
        rendimiento_hoy: this._calculateSales(invoices),
        mejor_cliente: this._getMejorCliente(invoices),
        mejor_proveedor: this._getMejorProveedor(expenseOrders),
        catalogo: masters.map(p => ({ 
            id: p.id, 
            nombre: p.nombre, 
            stock: p.stock || 0, 
            unidad: p.consume_unit || 'UNIDAD', 
            coste: p.last_purchase_price || 0 
        })),
        eventos_hoy: events.filter(e => (e.fecha || "").startsWith(todayStr)).map(e => e.descripcion || "").join(", "),
        clima: this._getWeatherData(ciudadEmpresa),
        bancos: settings.masters?.bank_accounts || []
      };

      if (hasInventoryAccess) {
        context.formulas_riesgo = formulas.filter(f => {
          const costs = Inventory_Controller._calculateRecursively(f.id, formulas, masters);
          const margenActual = (costs.margen_delivery / (parseFloat(f.pvp_canales?.delivery) || 1)) * 100;
          return margenActual < parseFloat(f.margen_objetivo_perc || 0);
        }).map(f => f.nombre); 
      }

      return { ok: true, data: context };
    } catch(e) { return { ok: false, msg: e.message }; }
  },

  _calculateDebt: function(effects) {
    const limit15d = new Date(); limit15d.setDate(new Date().getDate() + 15);
    return effects.filter(e => e.type === 'PAGO' && e.status === 'PENDIENTE' && new Date(e.vencimiento || e.date || "") <= limit15d).reduce((sum, e) => sum + (parseFloat(e.amount || e.total || 0)), 0);
  },

  _calculateSales: function(invoices) {
    const todayStr = new Date().toISOString().split('T')[0];
    return invoices.filter(i => (i.fecha || i.date || "").startsWith(todayStr)).reduce((sum, i) => sum + (parseFloat(i.total || 0)), 0);
  },

  _getMejorCliente: function(invoices) {
    const clienteFacturacion = invoices.reduce((acc, i) => { const c = i.cliente || "Desconocido"; acc[c] = (acc[c] || 0) + parseFloat(i.total || 0); return acc; }, {});
    return Object.keys(clienteFacturacion).reduce((a, b) => clienteFacturacion[a] > clienteFacturacion[b] ? a : b, "Ninguno");
  },

  _getMejorProveedor: function(expenseOrders) {
    const proveedorCompras = expenseOrders.reduce((acc, o) => { const p = o.vendor_id || o.proveedor || "Desconocido"; acc[p] = (acc[p] || 0) + parseFloat(o.total || 0); return acc; }, {});
    return Object.keys(proveedorCompras).reduce((a, b) => proveedorCompras[a] > proveedorCompras[b] ? a : b, "Ninguno");
  },

  // --- Helpers Privados para La Bola de Cristal ---
  _getWeatherData: function(city) {
    try {
      const res = UrlFetchApp.fetch(`https://wttr.in/${city}?format=%C+%t`, {
        'headers': { 'User-Agent': 'HandooTitanium' }
      });
      return res.getContentText();
    } catch(e) { return "14°C Despejado"; }
  },

  _getEventsData: function() {
    return "Racing de Santander juega esta semana en casa (pico de demanda esperado).";
  },

  _getViralFactor: function() {
    return "Alto impacto por tendencia en TikTok (plato estrella viral).";
  },

  /**
   * MÉTODO: Actionable CFO (Inteligencia Proactiva) V1.6
   */
  getProactiveInsights: function() {
    try {
      const apiKey = Admin_Controller._getSafeSetting("AI_API_KEY");
      if (!apiKey) throw new Error("Identidad Neural no configurada.");

      const cashFlow = Treasury_Controller.getCashFlowProjection().data;
      const creditLines = Treasury_Controller.listCreditLines().data;
      const allEffects = Treasury_Controller.listAllEffects().data;
      const settings = Admin_Controller.getSettings().data;
      const bankAccounts = settings.masters.bank_accounts;

      const today = new Date();
      const limit = new Date(); limit.setDate(today.getDate() + 30);
      const upcoming = allEffects.filter(e => {
        const vto = new Date(e.vencimiento);
        return e.status === 'PENDIENTE' && vto >= today && vto <= limit;
      });

      const model = Admin_Controller._getSafeSetting("AI_MODEL", "gemini-1.5-flash");
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const systemInstruction = `ACTÚA COMO EL DIRECTOR FINANCIERO (CFO) VIRTUAL DE HANDOO OS.
      TU TAREA ES ANALIZAR LA PROYECCIÓN DE CAJA A 30 DÍAS Y GENERAR ALERTAS PROACTIVAS Y ACCIONES EJECUTABLES.
      
      DATOS PROPORCIONADOS:
      1. CashFlow Proyectado (30 días): ${JSON.stringify(cashFlow)}
      2. Líneas de Crédito Disponibles: ${JSON.stringify(creditLines)}
      3. Cuentas Bancarias de Empresa (IBAN/Referencia): ${JSON.stringify(bankAccounts)}
      4. Documentos Pendientes (Cobros/Pagos): ${JSON.stringify(upcoming.slice(0,20))}
      5. Costes Estructurales Fijos: ${settings.fixed_costs}€/mes.

      REGLAS EJECUTIVAS:
      - Identifica CUALQUIER día con saldo proyectado negativo (DESCUBIERTO).
      - Propón una SOLUCIÓN TÉCNICA concreta en el objeto "action".
      - Si sugieres un traspaso de fondos, usa el tipo "INTERNAL_TRANSFER" y especifica las cuentas exactas.
      - Si sugieres anticipar una remesa, usa el tipo "PREPARE_REMITTANCE".
      - Sé breve y estratégico.
      
      RETORNA UN JSON PURO CON ESTA ESTRUCTURA:
      {
        "has_risk": true/false,
        "risk_level": "CRITICAL|WARNING|STABLE",
        "primary_alert": "Título breve de la alerta",
        "recommendations": ["Recomendación 1", "Recomendación 2"],
        "critical_date": "YYYY-MM-DD o null",
        "action": {
          "label": "Texto del botón (ej: Traspasar 2.000€ desde Póliza)",
          "type": "INTERNAL_TRANSFER|PREPARE_REMITTANCE",
          "payload": { 
             "source_account": "referencia contable origen",
             "target_account": "referencia contable destino (ej: 572000001)",
             "amount": 0,
             "concept": "Refuerzo de liquidez sugerido por Handoo AI"
          }
        }
      }`;

      const requestBody = {
        contents: [{ parts: [{ text: "Genera el briefing proactivo and la acción autónoma sugerida." }] }],
        system_instruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
      };

      const options = {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(requestBody),
        muteHttpExceptions: true
      };

      const res = UrlFetchApp.fetch(url, options);
      const json = JSON.parse(res.getContentText());

      if (res.getResponseCode() !== 200) throw new Error("Anomalía Neural CFO");

      const result = JSON.parse(json.candidates[0].content.parts[0].text);
      return Response.success(result);
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * MÉTODO: Parseo de Pedido por Voz (NLP) con Lógica de Chemin AI
   */
  parseVoiceOrder: function(payload) {
    try {
      const settings = Admin_Controller.getSettings().data;
      if (!settings.active_modules?.includes('IA_PREMIUM')) {
        return { reply: "Oído Chef, no tienes la licencia IA_PREMIUM activa." };
      }

      const apiKey = Admin_Controller._getSafeSetting("AI_API_KEY");
      if (!apiKey) throw new Error("Identidad Neural no configurada.");

      // 1. Obtener Data Lake
      const contextRes = this.getAIContext(payload.locationId);
      const contextStr = contextRes.ok ? JSON.stringify(contextRes.data) : "Datos no disponibles";

      const model = Admin_Controller._getSafeSetting("AI_MODEL", "gemini-1.5-flash");
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const systemInstruction = `ERES CHEMINAI, EL ÚNICO CEREBRO ESTRATÉGICO DE HANDOO.
      Tu misión es traducir voz a órdenes técnicas para el controlador que acabamos de instalar.

      CONTEXTO ACTUAL (Data Lake): ${contextStr}

      INTENCIONES DISPONIBLES:

      1. UNIT_CONV: Para crear o editar reglas de conversión.
         Params: buy_unit (ej: CAJA), factor (ej: 6), consume_unit (ej: BOTELLA), producto_nombre (opcional), producto_id (opcional).

      2. INV_AJUSTE: Para sumar o restar stock directamente.
         Params: producto_id (opcional), producto_nombre (opcional), cantidad, tipo ("SUMA" o "RESTA").

      3. WASTE_REG: Para mermas. USA EL INTENT "INV_AJUSTE" CON TIPO "RESTA".

      4. ORDER_DRAFT: Para generar borradores de pedidos.
         Params: proveedor, items (array de {producto, cantidad, unidad}).

      REGLAS DE ORO:
      - Responde SIEMPRE en JSON plano.
      - El campo 'reply' DEBE empezar por "Oído Chef," y confirmar la escala o acción.
      - Ejemplo de confirmación: "Oído Chef, configurada la escala de 1 CAJA a 6 BOTELLAS".
      - Si el usuario dice "Handoo, una caja tiene 6 botellas", infiere que es UNIT_CONV.
      - Si el usuario no especifica el producto pero el contexto sugiere uno, úsalo.`;

      const requestBody = {
        contents: [{ parts: [{ text: payload.text }] }],
        system_instruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
      };

      const res = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(requestBody),
        muteHttpExceptions: true
      });

      if (res.getResponseCode() !== 200) throw new Error("Fallo de conexión neural.");
      
      const aiResponse = JSON.parse(res.getContentText());
      let rawResult = aiResponse.candidates[0].content.parts[0].text;
      rawResult = rawResult.substring(rawResult.indexOf('{'), rawResult.lastIndexOf('}') + 1);
      const intent = JSON.parse(rawResult);

      // --- Ejecución de Intenciones ---
      const catalog = _DB.get("MASTERS") || [];

      if (intent.intent === 'UNIT_CONV') {
        let prodId = intent.params.producto_id;
        if (!prodId && intent.params.producto_nombre) {
          const prod = catalog.find(p => p.nombre.toLowerCase() === intent.params.producto_nombre.toLowerCase());
          if (prod) prodId = prod.id;
        }

        // Si seguimos sin producto_id, intentamos buscar el último producto modificado o algo razonable
        if (!prodId && catalog.length > 0) {
           // Fallback: si el usuario no dice el producto, pero solo hay uno que encaje con la conversación previa lo elegiríamos.
           // Por ahora devolvemos mensaje pidiendo aclaración si es crítico.
        }

        if(!prodId) return { ...intent, executed: false, reply: "Oído Chef, ¿para qué producto es esa escala de unidades?" };

        const resConv = Inventory_Controller.save_conversion({
          product_id: prodId,
          buy_unit: intent.params.buy_unit,
          consume_unit: intent.params.consume_unit,
          factor: intent.params.factor
        });
        return { ...intent, executed: resConv.ok, msg: resConv.msg };
      } 
      else if (intent.intent === 'INV_AJUSTE') {
        let prod = catalog.find(p => p.id === intent.params.producto_id || p.nombre.toLowerCase() === (intent.params.producto_nombre || "").toLowerCase());
        
        if (!prod && intent.params.producto_nombre) {
          const newId = _DB.getNextSequentialId ? _DB.getNextSequentialId("MASTERS", "PROD") : "PROD-" + Date.now();
          prod = { id: newId, nombre: intent.params.producto_nombre, stock: 0, type: 'PRODUCT' };
          _DB.save("MASTERS", newId, prod);
        }

        if (prod) {
          intent.params.producto_id = prod.id;
          const resAdj = Inventory_Controller.adjust_stock(intent.params);
          return { ...intent, executed: resAdj.ok, msg: resAdj.msg };
        } else {
          return { ...intent, executed: false, reply: "Oído Chef, no encuentro el producto para ajustar el inventario." };
        }
      }
      else if (intent.intent === 'ORDER_DRAFT') {
        const draft = {
            id: "DRAFT-" + Date.now(),
            proveedor: intent.params.proveedor,
            items: intent.params.items,
            status: 'DRAFT',
            timestamp: new Date().toISOString()
        };
        _DB.save("DB_PENDING_ORDERS", draft.id, draft); // Guardamos en la tabla de pedidos pendientes
        return { ...intent, executed: true, reply: "Oído Chef, borrador de pedido guardado para " + intent.params.proveedor };
      }

      return { reply: "Oído Chef, no he entendido la orden técnica." };
      
    } catch(e) { 
      return { reply: "Oído Chef, error técnico: " + e.message }; 
    }
  },

  /**
   * MÉTODO: Recuperación de Cuarentena Oído Chef
   * @deprecated Usar AI_Controller.parseVoiceOrder para toda la lógica de voz.
   */
  getOidoChefQuarantine: function() {
    return Response.error("Esta función está obsoleta. Use AI_Controller.parseVoiceOrder.");
  },

  /**
   * MÉTODO: Procesar Acción de Oído Chef (Clasificación y Ejecución)
   * @deprecated Usar AI_Controller.parseVoiceOrder para toda la lógica de voz.
   */
  processOidoChefAction: function(payload) {
    return Response.error("Esta función está obsoleta. Use AI_Controller.parseVoiceOrder.");
  },

  /**
   * MÉTODO: Captura Externa V112 (ALEXA GATEWAY)
   */
  handleExternalCapture: function(data) {
    try {
      const parsed = this.parseVoiceOrder({ text: data.text });
      if(!parsed.ok) return parsed;

      const order = parsed.data;
      const id = "INB-" + Date.now();
      const inboxItem = {
        id: id,
        source: data.source || "EXTERNAL",
        raw_text: data.text,
        structured_data: order,
        timestamp: new Date().toISOString()
      };

      _DB.save("DB_INBOX_QUEUE", id, inboxItem);
      return Response.success(inboxItem, "Pedido recibido y puesto en cola de validación.");
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * Procesa un documento (Albarán/Factura) usando el motor de visión de Google.
   */
  processDocument: function(payload) {
    try {
      const apiKey = Admin_Controller._getSafeSetting("AI_API_KEY");
      if (!apiKey) throw new Error("Identidad Neural no configurada. Asigne una API_KEY en Ajustes.");

      const model = Admin_Controller._getSafeSetting("AI_MODEL", "gemini-1.5-flash");
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const prompt = `
        ACTÚA COMO ANALISTA DE RECEPCIÓN INDUSTRIAL Y CUMPLIMIENTO APPCC.
        
        TAREA: Extrae la información del documento adjunto (Factura o Albarán).
        
        REQUISITOS OBLIGATORIOS:
        1. Identifica el tipo: INVOICE (Factura), DELIVERY_NOTE (Albarán) u ORDER (Pedido).
        2. FECHAS: Todas deben ir en formato YYYY-MM-DD. Si no es clara, usa la de hoy.
        3. DIRECCIÓN PROVEEDOR: Separa obligatoriamente en campos individuales.
        4. PRODUCTOS:
           - concept: Nombre descriptivo.
           - category: Clasificación industrial (CARNE, PESCADO, BAKERY, BEBIDAS, DRY, FRUTA, VERDURA, SUMINISTROS).
           - vendor_ref: Código o referencia del proveedor.
           - qty: Cantidad.
           - price: Precio unitario base (sin impuestos).
           - iva: Porcentaje de impuesto aplicado a esta línea.
           - requires_thermal: BOOLEANO (true si es alimento fresco/congelado).
           - expiry: Fecha de caducidad si aparece (YYYY-MM-DD).

        RETORNA EXCLUSIVAMENTE UN JSON PURO CON ESTA ESTRUCTURA:
        {
          "detected_type": "INVOICE|DELIVERY_NOTE|ORDER",
          "vendor": "Nombre Fiscal",
          "vendor_cif": "CIF",
          "vendor_street_type": "Calle/Av/Plaza",
          "vendor_street_name": "Nombre de la calle",
          "vendor_street_number": "Número/Portal",
          "vendor_postal_code": "Código Postal",
          "vendor_city": "Población/Localidad",
          "vendor_province": "Provincia",
          "vendor_email": "Email",
          "vendor_phone": "Teléfono",
          "vendor_iban": "IBAN si aparece",
          "doc_num": "Número de factura/albarán",
          "date": "YYYY-MM-DD",
          "due_date": "YYYY-MM-DD",
          "payment_method_detected": "TRANSFERENCIA|SEPA|EFECTIVO|TARJETA",
          "delivery_notes": ["Nº Albarán 1", "Nº Albarán 2"],
          "global_lote": "Lote si es general",
          "items": [
            {
              "concept": "...",
              "category": "...",
              "vendor_ref": "...",
              "qty": 0,
              "price": 0,
              "iva": 21,
              "requires_thermal": true|false,
              "lote": "...",
              "expiry": "YYYY-MM-DD"
            }
          ]
        }
      `;

      const requestBody = {
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType: payload.mime || "image/jpeg", data: payload.base64.split(',')[1] } }
          ]
        }],
        generationConfig: { 
          responseMimeType: "application/json",
          temperature: 0.1
        }
      };

      const options = {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(requestBody),
        muteHttpExceptions: true
      };

      const res = UrlFetchApp.fetch(url, options);
      const resText = res.getContentText();
      const json = JSON.parse(resText);

      if (res.getResponseCode() !== 200) {
        throw new Error(json.error ? json.error.message : "Fallo en motor de visión Gemini API");
      }

      let rawResult = json.candidates[0].content.parts[0].text;
      rawResult = rawResult.substring(rawResult.indexOf('{'), rawResult.lastIndexOf('}') + 1);
      
      return Response.success(JSON.parse(rawResult));

    } catch(e) {
      return Response.error("Fallo en Análisis Neural: " + e.message);
    }
  },

  /**
   * MÉTODO: Procesar foto de inventario y cruzar con catálogo (V1.0)
   */
  processInventoryPhoto: function(payload) {
    try {
      if (!Module_Admin.checkAccess('FEAT_INVENTORY_VISION')) {
        return Response.error("Módulo de Inventario Visual no activo.");
      }
      
      const apiKey = Admin_Controller._getSafeSetting("AI_API_KEY");
      if (!apiKey) throw new Error("Identidad Neural no configurada.");

      const model = Admin_Controller._getSafeSetting("AI_MODEL", "gemini-1.5-flash");
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const systemInstruction = 'Eres un experto en inventarios de hostelería. Mira la foto y detecta los productos del catálogo. Devuelve un JSON con: nombre_producto, cantidad_detectada, unidad (botella, caja, etc.) y expiry_date (si aparece en formato YYYY-MM-DD).';

      const requestBody = {
        contents: [{
          parts: [
            { text: "Analiza esta foto de inventario." },
            { inlineData: { mimeType: payload.mime || "image/jpeg", data: payload.image.split(',')[1] } }
          ]
        }],
        system_instruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
      };

      const options = {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(requestBody),
        muteHttpExceptions: true
      };

      const res = UrlFetchApp.fetch(url, options);
      if (res.getResponseCode() !== 200) throw new Error("Fallo en motor de visión");

      const aiResponse = JSON.parse(res.getContentText());
      const detectedItems = JSON.parse(aiResponse.candidates[0].content.parts[0].text);

      const catalog = _DB.get("MASTERS");
      const results = detectedItems.map(item => {
        const prod = catalog.find(p => p.nombre.toLowerCase() === item.nombre_producto.toLowerCase());
        let warning = null;

        if (prod && item.expiry_date && prod.batches && prod.batches.length > 0) {
          const newestBatch = prod.batches.reduce((a, b) => new Date(a.entry_date) > new Date(b.entry_date) ? a : b);
          if (new Date(item.expiry_date) < new Date(newestBatch.expiry_date)) {
            warning = 'ROTATION_ERROR';
          }
        }

        return {
          producto_id: prod ? prod.id : null,
          producto_nombre: item.nombre_producto,
          cantidad: item.cantidad_detectada,
          unidad: item.unidad,
          expiry_date: item.expiry_date,
          warning_type: warning,
          tipo: "SUMA"
        };
      });
      return Response.success({ items: results });
    } catch(e) {
      return Response.error("Fallo en Análisis Neural: " + e.message);
    }
  },

  /**
   * MÉTODO: Resolver código de barras cruzando con catálogo
   */
  resolveBarcode: function(payload) {
    try {
      const barcode = payload.barcode;
      const catalog = _DB.get("MASTERS") || [];
      
      // Buscamos en el catálogo por el campo barcode (si existe) o en alias
      const prod = catalog.find(p => 
        p.barcode === barcode || 
        (p.aliases && p.aliases.some(a => a.barcode === barcode))
      );
      
      if (prod) {
        return Response.success({
          producto_id: prod.id,
          nombre: prod.nombre,
          cantidad: 1,
          unidad: prod.consume_unit || 'UNIDAD',
          base_unit_info: prod.buy_unit ? `1 ${prod.buy_unit} = ${prod.factor || 1} ${prod.consume_unit}` : ''
        });
      } else {
        return Response.success({
          producto_id: 'NOT_CATALOGED',
          nombre: "CÓDIGO: " + barcode,
          cantidad: 1,
          unidad: 'UNIDAD'
        });
      }
    } catch(e) {
      return Response.error("Error al resolver código de barras: " + e.message);
    }
  },

  /**
   * MÉTODO: Guardar inventario desde escáner y verificar stock de seguridad
   */
  saveInventoryFromScanner: function(payload) {
    try {
      payload.items.forEach(item => {
        Inventory_Controller.adjust_stock(item);
      });

      const warnings = [];
      const catalog = _DB.get("MASTERS");
      
      payload.items.forEach(item => {
        const prod = catalog.find(p => p.id === item.producto_id);
        if (prod && prod.safety_stock && (prod.stock || 0) < prod.safety_stock) {
          warnings.push(`⚠️ ATENCIÓN: Stock por debajo del mínimo para ${prod.nombre} (Quedan ${prod.stock} de ${prod.safety_stock})`);
        }
      });

      return Response.success({ warnings }, "Inventario guardado correctamente.");
    } catch(e) {
      return Response.error("Fallo al guardar inventario: " + e.message);
    }
  },

  /**
   * MÉTODO: Generar pedido automático para productos bajo mínimos
   */
  generateAutoOrder: function(payload) {
    try {
      const catalog = _DB.get("MASTERS");
      const orders = [];

      payload.items.forEach(item => {
        const prod = catalog.find(p => p.id === item.producto_id);
        if (prod && prod.safety_stock && (prod.stock || 0) < prod.safety_stock) {
          const qtyToBuy = (prod.safety_stock * 2) - (prod.stock || 0);
          const bestProvider = Vendor_Controller.getMarketBestPrice(prod.id);
          
          orders.push({
            proveedor: bestProvider.nombre,
            producto: prod.nombre,
            cantidad: qtyToBuy,
            unidad: prod.buy_unit_default || 'UNIDAD'
          });
        }
      });

      const draft = orders.map(o => `Hola ${o.proveedor}, necesito ${o.cantidad} ${o.unidad} de ${o.producto}.`).join('\n');
      return Response.success({ draft }, "Pedido generado correctamente.");
    } catch(e) {
      return Response.error("Fallo al generar pedido: " + e.message);
    }
  }
};
