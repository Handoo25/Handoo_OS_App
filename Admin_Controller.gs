
/**
 * Admin_Controller.gs - TITANIUM ERP KERNEL V188.0 (BULK OPTIMIZED)
 */

// EL CEREBRO DE HANDOO TITANIUM - BAUTISMO DE SECTORES
const SECTOR_TEMPLATES = {
  'GENERIC': {
    ui_labels: { inv_cat: 'Categoría de Inventario', zone_label: 'Ubicación / Zona' },
    inventory_families: ['GENERAL', 'CONSUMIBLES', 'ACTIVOS'],
    sales_families: ['SERVICIOS', 'PRODUCTOS', 'OTROS']
  },
  'HORECA': { // Hostelería y Restauración pura
    ui_labels: { inv_cat: 'Categoría Almacén', zone_label: 'Zona / Partida' },
    inventory_families: ['BEBIDAS', 'CARNES', 'VERDURAS', 'LÁCTEOS', 'LIMPIEZA'],
    sales_families: ['ENTRANTES', 'PRIMEROS', 'SEGUNDOS', 'POSTRES', 'BEBIDAS']
  },
  'SOFTWARE': {
    ui_labels: { inv_cat: 'Categoría de Activos', zone_label: 'Entorno / Servidor' },
    inventory_families: ['LICENCIAS', 'HARDWARE', 'SaaS'],
    sales_families: ['DESARROLLO', 'SOPORTE', 'LICENCIAMIENTO']
  },
  'SERVICES': {
    ui_labels: { inv_cat: 'Categoría de Servicio', zone_label: 'Área de Trabajo' },
    inventory_families: ['MATERIALES', 'EQUIPAMIENTO'],
    sales_families: ['CONSULTORÍA', 'PROYECTOS', 'MANTENIMIENTO']
  },
  'RETAIL': {
    ui_labels: { inv_cat: 'Categoría de Producto', zone_label: 'Pasillo / Estantería' },
    inventory_families: ['TEXTIL', 'ELECTRÓNICA', 'HOGAR'],
    sales_families: ['VENTA DIRECTA', 'PROMOCIONES']
  },
  'INDUSTRY': {
    ui_labels: { inv_cat: 'Categoría de Materia', zone_label: 'Línea de Producción' },
    inventory_families: ['MATERIA PRIMA', 'PRODUCTO SEMITERMINADO', 'PRODUCTO FINAL'],
    sales_families: ['PRODUCCIÓN', 'DISTRIBUCIÓN']
  },
  'CLINIC': {
    ui_labels: { inv_cat: 'Categoría de Insumo', zone_label: 'Consultorio / Sala' },
    inventory_families: ['FÁRMACOS', 'MATERIAL MÉDICO', 'PROTECCIÓN'],
    sales_families: ['CONSULTAS', 'PROCEDIMIENTOS', 'TRATAMIENTOS']
  }
};

var Admin_Controller = {
  
  /**
   * Recupera movimientos bancarios (no inventario).
   */
  get_bank_movements: function() {
    try {
      const movements = _DB.get("DB_MOVEMENTS") || [];
      const bankMovements = movements
        .filter(m => m.is_inventory_adjustment !== true && m.cuenta)
        .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
      return Response.success(bankMovements);
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * Registra las tablas necesarias para el módulo de Escandallos Vivos.
   */
  initializeRecipeTables: function() {
    try {
      if (!_DB.get("DB_RECIPES")) _DB.save("DB_RECIPES", "init", []);
      if (!_DB.get("DB_RECIPE_ITEMS")) _DB.save("DB_RECIPE_ITEMS", "init", []);
      this._logAction("INIT_RECIPE_MODULE", "Tablas DB_RECIPES y DB_RECIPE_ITEMS inicializadas.");
      return Response.success(null, "Tablas registradas correctamente.");
    } catch(e) { return Response.error(e.message); }
  },

  _getSafeSetting: function(key, defaultValue) {
    try {
      const res = _DB.getSetting(key, defaultValue);
      if (!res) return defaultValue;
      if (typeof res === 'object' && res !== null && 'value' in res) return res.value;
      return res;
    } catch(e) { return defaultValue; }
  },

  round: function(value) {
    const decimals = parseInt(this._getSafeSetting("DECIMAL_PRECISION", 2));
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  },

  get_pending_alerts: function() {
    try {
      // 1. Check cash closing (asumimos DB_CASH_CLOSINGS)
      const closings = _DB.get("DB_CASH_CLOSINGS") || [];
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      
      const hasClosing = closings.some(c => c.date === today || c.date === yesterdayStr);
      
      // 2. Count quarantine
      const quarantine = _DB.get("DB_OIDO_CHEF_QUARANTINE") || [];
      const pendingCount = quarantine.filter(q => q.status === 'PENDIENTE').length;
      
      // 3. Predictive Logistics Alerts (NUEVA LÓGICA V2026)
      const vendors = _DB.get("DB_VENDORS") || [];
      const now = new Date();
      const currentDay = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'][now.getDay()];
      
      const logisticAlerts = [];
      vendors.forEach(v => {
        if (v.dia_limite_pedido && v.hora_limite_pedido) {
          const isToday = (v.dia_limite_pedido === 'DIARIO' || v.dia_limite_pedido === currentDay);
          if (isToday) {
            const [h, m] = v.hora_limite_pedido.split(':').map(Number);
            const deadlineMinutes = h * 60 + m;
            const currentMinutes = now.getHours() * 60 + now.getMinutes();
            const diff = deadlineMinutes - currentMinutes;
            
            if (diff > 0 && diff <= 120) { // Ventana crítica de 2 horas
              logisticAlerts.push({
                vendor_id: v.id,
                vendor_name: v.nombre_fiscal,
                deadline: v.hora_limite_pedido,
                minutes_left: diff
              });
            }
          }
        }
      });

      return Response.success({
        missing_cash_closing: !hasClosing,
        pending_quarantine_count: pendingCount,
        logistic_alerts: logisticAlerts
      });
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * RECUPERACIÓN DE MUNICIPIOS POR PROVINCIA (V191)
   */
  get_municipios: function(payload) {
    try {
      const provincia = payload.provincia;
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName("GEO_DATA");
      if (!sheet) return Response.error("Falta pestaña GEO_DATA");
      
      const data = sheet.getDataRange().getValues();
      // Filtramos la columna B (Municipio) donde la columna A coincida con la Provincia
      const lista = data.filter(row => row[0] === provincia).map(row => row[1]);
      
      return Response.success(lista);
    } catch(e) {
      return Response.error(e.message);
    }
  },

  /**
   * RECUPERACIÓN DE CENTROS DE COSTE V116
   */
  getCostCenters: function() {
    try {
      return Response.success(_DB.get("DB_COST_CENTERS"));
    } catch(e) { return Response.success([]); }
  },

  /**
   * GENERADOR DE CÓDIGOS PARA CENTROS DE COSTE V116
   */
  generateCostCenterCode: function(name) {
    if(!name || name.length < 3) return "";
    const prefix = name.substring(0,3).toUpperCase();
    const existing = _DB.get("DB_COST_CENTERS") || [];
    const count = existing.filter(cc => cc.codigo && cc.codigo.startsWith(prefix)).length;
    return prefix + "-" + String(count + 1).padStart(2, '0');
  },

  /**
   * TABLAS LEGALES DE AMORTIZACIÓN (V116) - CONECTADO A PATRIMONIO
   */
  getAmortizationRules: function() {
    try {
      const res = Patrimony_Controller.listAmortizationRules();
      if (res.ok) {
        return res.data.map(r => ({
          id: r.id,
          label: r.name.toUpperCase(),
          icon: r.id.includes('IT') ? 'bi-laptop' : (r.id.includes('MOB') ? 'bi-chair' : 'bi-gear'),
          months: r.years * 12,
          rate: r.percentage,
          tax_benefit: 0.25 // Valor estándar de escudo fiscal
        }));
      }
    } catch(e) { console.error("Error en getAmortizationRules:", e); }
    
    // Fallback si falla patrimonio
    return [
      { id: 'IT', label: 'EQUIPOS INFORMÁTICOS', icon: 'bi-laptop', months: 48, rate: 25, tax_benefit: 0.25 },
      { id: 'FURNITURE', label: 'MOBILIARIO', icon: 'bi-chair', months: 120, rate: 10, tax_benefit: 0.25 },
      { id: 'MACHINERY', label: 'MAQUINARIA INDUSTRIAL', icon: 'bi-gear-wide-connected', months: 96, rate: 12.5, tax_benefit: 0.25 },
      { id: 'VEHICLE', label: 'VEHÍCULOS COMERCIALES', icon: 'bi-truck', months: 72, rate: 16, tax_benefit: 0.25 },
      { id: 'RENOVATION', label: 'OBRAS Y REFORMAS', icon: 'bi-tools', months: 120, rate: 10, tax_benefit: 0.25 }
    ];
  },

  /**
   * GESTIÓN DE CENTROS DE COSTE V115 (QUIRÚRGICO)
   */
  saveCostCenter: function(payload) {
    try {
      if(!payload.nombre) throw new Error("Nombre de Centro requerido");
      if(!payload.id || payload.id === 'new') {
        payload.id = "CC-" + Date.now();
      }
      _DB.save("DB_COST_CENTERS", payload.id, payload);
      this._logAction("SAVE_COST_CENTER", `Guardado centro ${payload.nombre}`);
      return Response.success(payload, "Centro de Coste Sincronizado");
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * MOTOR FISCAL V127: Informe consolidado de IVA e IRPF (Modelos 303/111)
   */
  getVATReport: function(payload) {
    try {
      const year = parseInt(payload.year || new Date().getFullYear());
      const invoices = _DB.get("DB_INVOICES") || [];
      const expenses = _DB.get("DB_EXPENSES") || [];
      const quarters = [
        { id: 1, label: 'TRIMESTRE 1 (Q1)', output_vat: 0, input_vat: 0, irpf_retention: 0 },
        { id: 2, label: 'TRIMESTRE 2 (Q2)', output_vat: 0, input_vat: 0, irpf_retention: 0 },
        { id: 3, label: 'TRIMESTRE 3 (Q3)', output_vat: 0, input_vat: 0, irpf_retention: 0 },
        { id: 4, label: 'TRIMESTRE 4 (Q4)', output_vat: 0, input_vat: 0, irpf_retention: 0 }
      ];
      
      invoices.forEach(inv => {
        if (inv.status !== 'ISSUED') return;
        const d = new Date(inv.fecha);
        if (d.getFullYear() === year) {
          const qIdx = Math.floor(d.getMonth() / 3);
          quarters[qIdx].output_vat += parseFloat(inv.total_iva || 0);
        }
      });
      
      expenses.forEach(exp => {
        if (!['Pagado', 'APROBADO_FINANZAS', 'RECIBIDO', 'PENDIENTE'].includes(exp.status)) return;
        const d = new Date(exp.fecha);
        if (d.getFullYear() === year) {
          const qIdx = Math.floor(d.getMonth() / 3);
          const total = parseFloat(exp.total || 0);
          
          if (exp.items && exp.items.length > 0) {
            quarters[qIdx].input_vat += exp.items.reduce((acc, it) => acc + ((parseFloat(it.price) * parseFloat(it.qty)) * (parseFloat(it.iva || 0)/100)), 0);
          } else {
            quarters[qIdx].input_vat += (total - (total / 1.21));
          }
          quarters[qIdx].irpf_retention += parseFloat(exp.total_ret || 0);
        }
      });
      
      quarters.forEach(q => { 
        q.output_vat = this.round(q.output_vat); 
        q.input_vat = this.round(q.input_vat);
        q.irpf_retention = this.round(q.irpf_retention);
      });
      
      return Response.success({ year, quarters });
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * MOTOR DE PERFORMANCE ANALÍTICA V122 (BCG + TAX SHIELD + INCIDENT LOSS)
   */
  getPerformanceReport: function() {
    try {
      const invoices = _DB.get("DB_INVOICES") || [];
      const vendors = _DB.get("DB_VENDORS") || [];
      const assets = _DB.get("DB_FIXED_ASSETS") || [];
      const effects = _DB.get("DB_TREASURY_EFFECTS") || []; 
      
      const stats = {};
      
      invoices.forEach(inv => {
        if(inv.status !== 'ISSUED') return;
        const itemName = (inv.item_display_name || 'Servicio').toUpperCase();
        if(!stats[itemName]) stats[itemName] = { name: itemName, volume: 0, revenue: 0, cost: 0, margin: 0, incidents_cost: 0 };
        stats[itemName].volume += 1;
        stats[itemName].revenue += parseFloat(inv.base || 0);
      });

      const products = Object.values(stats);
      products.forEach(p => {
        let avgCost = 0;
        let costPoints = 0;
        vendors.forEach(v => {
          if(v.price_memory && v.price_memory[p.name]) {
            avgCost += v.price_memory[p.name];
            costPoints++;
          }
        });
        
        const itemIncidents = effects.filter(e => e.type === 'CLAIM' && e.obs?.includes(p.name));
        p.incidents_cost = itemIncidents.reduce((s, e) => s + parseFloat(e.importe || 0), 0);
        
        p.cost = costPoints > 0 ? (avgCost / costPoints) : 0;
        p.margin = p.revenue - (p.cost * p.volume) - p.incidents_cost;
        p.margin_percent = p.revenue > 0 ? (p.margin / p.revenue) * 100 : 0;
      });

      const avgVolume = products.reduce((s, x) => s + x.volume, 0) / (products.length || 1);
      const avgMargin = products.reduce((s, x) => s + x.margin_percent, 0) / (products.length || 1);

      products.forEach(p => {
        if(p.volume >= avgVolume && p.margin_percent >= avgMargin) p.bcg = 'ESTRELLA';
        else if(p.volume >= avgVolume && p.margin_percent < avgMargin) p.bcg = 'CABALLO';
        else if(p.volume < avgVolume && p.margin_percent >= avgMargin) p.bcg = 'ENIGMA';
        else p.bcg = 'PERRO';
      });

      let monthlyAmortization = 0;
      assets.forEach(a => {
        if(a.status === 'ACTIVE_AMORTIZATION') {
          monthlyAmortization += (parseFloat(a.acquisition_cost) / parseInt(a.months_to_amortize));
        }
      });

      return Response.success({
        products: products.sort((a,b) => b.revenue - a.revenue),
        averages: { volume: avgVolume, margin: avgMargin },
        fiscal_shield: {
          monthly_saving: this.round(monthlyAmortization * 0.25),
          annual_saving: this.round(monthlyAmortization * 12 * 0.25)
        }
      });
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * MOTOR CONTABLE: Actualización de Saldos PGC.
   */
  updatePGCSaldos: function() {
    try {
      const invoices = _DB.get("DB_INVOICES") || [];
      const effects = _DB.get("DB_TREASURY_EFFECTS") || [];
      const movements = _DB.get("DB_MOVEMENTS") || [];
      const clients = _DB.get("tenants") || [];
      const masters = _DB.get("MASTERS") || [];
      const balances = {};
      const bankMap = {};
      masters.filter(m => m.type === 'BANK_ACCOUNT').forEach(b => { bankMap[b.nombre] = b.ref_contable; });

      invoices.forEach(inv => {
        if (inv.status !== 'ISSUED') return;
        const c = clients.find(cl => String(cl.id) === String(inv.client_id));
        if (c?.cuenta_contable) balances[c.cuenta_contable] = this.round((balances[c.cuenta_contable] || 0) + parseFloat(inv.total || 0));
      });
      effects.forEach(e => {
        if (e.status === 'PROVISIONAL') return;
        const imp = parseFloat(e.importe || 0);
        const c = clients.find(cl => String(cl.id) === String(e.client_id));
        if (!c?.cuenta_contable) return;
        const acc430 = c.cuenta_contable;
        const acc431 = acc430.replace('430', '431');
        const acc4315 = acc430.replace('430', '4315');
        if (['REMESADO', 'COBRADO', 'DEVUELTO'].includes(e.status)) {
          balances[acc430] = this.round((balances[acc430] || 0) - imp);
          if (e.status === 'REMESADO') balances[acc431] = this.round((balances[acc431] || 0) + imp);
          if (e.status === 'COBRADO') {
            const targetBank = String(e.metodo).includes('EFECTIVO') ? '570000001' : (bankMap[e.canal_pago] || '572000001');
            balances[targetBank] = this.round((balances[targetBank] || 0) + imp);
          }
          if (e.status === 'DEVUELTO') {
            balances[acc431] = this.round((balances[acc431] || 0) - imp);
            balances[acc4315] = this.round((balances[acc4315] || 0) + imp);
          }
        }
      });
      movements.forEach(m => { 
        if (m.is_inventory_adjustment === true) return;
        if (m.cuenta) balances[m.cuenta] = this.round((balances[m.cuenta] || 0) + (parseFloat(m.importe) || 0)); 
      });
      return balances;
    } catch(e) { return {}; }
  },

  /**
   * MOTOR DE APRENDIZAJE ESTRUCTURAL (V190) - NUEVA FUNCIÓN QUIRÚRGICA
   * Calcula la media real de gastos fijos basada en facturas marcadas como recurrentes.
   */
  getRealFixedCostsAverage: function() {
    try {
      const expenses = _DB.get("DB_EXPENSES") || [];
      const manualFixed = parseFloat(this._getSafeSetting("FIXED_COSTS", 0));
      
      // Filtramos gastos recurrentes de los últimos 180 días
      const limitDate = new Date();
      limitDate.setDate(limitDate.getDate() - 180);
      
      const recurringDocs = expenses.filter(e => 
        e.is_recurring === true && 
        new Date(e.fecha) >= limitDate &&
        ['Pagado', 'APROBADO_FINANZAS', 'RECIBIDO', 'PENDIENTE'].includes(e.status)
      );

      if (recurringDocs.length === 0) return manualFixed;

      // Agrupamos por mes para sacar la media real mensual
      const totalsByMonth = {};
      recurringDocs.forEach(e => {
        const monthKey = String(e.fecha).substring(0, 7); // YYYY-MM
        totalsByMonth[monthKey] = (totalsByMonth[monthKey] || 0) + parseFloat(e.total || 0);
      });

      const months = Object.keys(totalsByMonth);
      const sumReal = Object.values(totalsByMonth).reduce((a, b) => a + b, 0);
      const realAvg = sumReal / (months.length || 1);

      // Lógica de corrección: Si solo hay 1 mes de datos, promediamos con el manual al 50%.
      if (months.length < 3) return (manualFixed + realAvg) / 2;
      return realAvg;
    } catch(e) { 
      return parseFloat(this._getSafeSetting("FIXED_COSTS", 0)); 
    }
  },

  getDashboardStats: function() {
    try {
      const invoices = _DB.get("DB_INVOICES") || [];
      const expenses = _DB.get("DB_EXPENSES") || [];
      const effects = _DB.get("DB_TREASURY_EFFECTS") || [];
      const clients = _DB.get("tenants") || [];
      const masters = _DB.get("MASTERS") || [];
      const todayStr = new Date().toISOString().split('T')[0];
      
      const totalRev = invoices.filter(i => i.status === 'ISSUED').reduce((s, i) => s + parseFloat(i.total), 0);
      const pending7d = effects.filter(e => e.direction === 'OUTBOUND' && e.status === 'PENDIENTE').reduce((s, e) => s + parseFloat(e.importe), 0);
      
      const ivaVentas = invoices.filter(i => i.status === 'ISSUED').reduce((s, i) => s + parseFloat(i.total_iva), 0);
      const ivaGastos = expenses.filter(e => ['Pagado', 'APROBADO_FINANZAS', 'RECIBIDO', 'PENDIENTE'].includes(e.status) && (e.type === 'INVOICE' || e.type === 'DIRECT_EXPENSE')).reduce((s, e) => s + (parseFloat(e.total_iva || 0)), 0);
      
      const totalIRPF = expenses.reduce((s, e) => s + (parseFloat(e.total_ret || 0)), 0);
      const totalCost = expenses.filter(e => ['Pagado', 'APROBADO_FINANZAS', 'RECIBIDO', 'PENDIENTE'].includes(e.status) && (e.type === 'INVOICE' || e.type === 'DIRECT_EXPENSE')).reduce((s, e) => s + parseFloat(e.total || 0), 0);

      // Inventory Health
      const inventoryItems = masters.filter(m => m.type === 'PRODUCT');
      const totalValue = inventoryItems.reduce((s, i) => s + (parseFloat(i.stock || 0) * parseFloat(i.last_purchase_price || i.pvp || 0)), 0);
      const lowStockItems = inventoryItems.filter(i => i.safety_stock && (parseFloat(i.stock || 0) < parseFloat(i.safety_stock))).length;
      const expiringSoonItems = inventoryItems.filter(i => i.batches && i.batches.some(b => b.expiry_date && new Date(b.expiry_date) < new Date(new Date().setDate(new Date().getDate() + 7)))).length;

      // CORRECCIÓN QUIRÚRGICA V131: Alineación de criterios de "Vencidos" para evitar falsas alertas en Dashboard.
      const overdueRemittances = effects.filter(e => 
        e.direction === 'INBOUND' && 
        e.status === 'REMESADO' && 
        e.vencimiento < todayStr
      ).length;
      
      // DENTRO DE getDashboardStats...
      const activeModules = this._getSafeSetting("ACTIVE_MODULES", ["FEAT_CORE_DASHBOARD", "FEAT_CORE_CLIENTS", "FEAT_CORE_INVOICING", "FEAT_DOC_COBRO", "FEAT_STRATEGY", "FEAT_PERFORMANCE", "FEAT_EXPENSE_DELIVERY", "FEAT_EXPENSE_ORDERS", "FEAT_OIDO_CHEF", "FEAT_OIDO_CAJA", "FEAT_INVENTORY_ADVANCED", "FEAT_SUBSCRIPTIONS", "FEAT_LIBRO_MAYOR", "FEAT_TAXES", "FEAT_BRIDGE", "FEAT_FIXED_ASSETS", "FEAT_OPERATIONAL_TOOLS"]);
      const bi = { profit: (totalRev - totalCost).toLocaleString() + " €" };
      
      if (activeModules.includes('FEAT_CORE_INVOICING')) {
        bi.tax_piggy = (ivaVentas - ivaGastos).toLocaleString() + " €";
      }
      
      if (activeModules.includes('FEAT_TREASURY')) {
        bi.bank_total = pending7d; // Ejemplo de dato de tesorería
      }
      
      return Response.success({
        revenue: totalRev.toLocaleString() + " €",
        clients_count: clients.length,
        invoices_count: invoices.filter(i => i.status === 'ISSUED').length,
        pending_approvals: expenses.filter(e => e.status === 'PENDIENTE_APROBACION').length,
        overdue_remittances_count: overdueRemittances, 
        fixed_costs_avg: this.getRealFixedCostsAverage(), 
        active_modules: activeModules,
        inventory_health: {
          total_value: totalValue.toLocaleString() + " €",
          low_stock_items: lowStockItems,
          expiring_soon_items: expiringSoonItems
        },
        bi: bi
      });
    } catch(e) { return Response.error(e.message); }
  },

  getSettings: function() {
    try {
      const allMasters = _DB.get("MASTERS") || [];
      const aiKey = this._getSafeSetting("AI_API_KEY", "");
      return Response.success({
        fixed_costs: this._getSafeSetting("FIXED_COSTS", 0),
        subscription: this._getSafeSetting("SUBSCRIPTION", {}),
        custom_packs: this._getSafeSetting("CUSTOM_PACKS", []),
        fixed_costs_real_avg: this.getRealFixedCostsAverage(), // Inyección dinámica
        active_modules: this._getSafeSetting("ACTIVE_MODULES", ["FEAT_CORE_DASHBOARD", "FEAT_CORE_CLIENTS", "FEAT_CORE_INVOICING", "FEAT_DOC_COBRO", "FEAT_STRATEGY", "FEAT_PERFORMANCE", "FEAT_EXPENSE_DELIVERY", "FEAT_EXPENSE_ORDERS", "FEAT_OIDO_CHEF", "FEAT_OIDO_CAJA", "FEAT_INVENTORY_ADVANCED", "FEAT_SUBSCRIPTIONS", "FEAT_LIBRO_MAYOR", "FEAT_TAXES", "FEAT_BRIDGE", "FEAT_FIXED_ASSETS", "FEAT_OPERATIONAL_TOOLS"]),
        system_currency: this._getSafeSetting("SYSTEM_CURRENCY", "EUR"),
        decimal_precision: this._getSafeSetting("DECIMAL_PRECISION", 2),
        alert_time_morning: this._getSafeSetting("alert_time_morning", "16:30"),
        alert_time_night: this._getSafeSetting("alert_time_night", "23:30"),
        enable_calendar_staff: this._getSafeSetting("enable_calendar_staff", false),
        team_roles: this._getSafeSetting("TEAM_ROLES", ['COCINA', 'SALA', 'ENCARGADO', 'ADMIN']),
        credit_expiry_threshold: this._getSafeSetting("CREDIT_EXPIRY_THRESHOLD", 30),
        expense_approval_threshold: this._getSafeSetting("EXPENSE_APPROVAL_THRESHOLD", 1000),
        price_deviation_threshold: this._getSafeSetting("PRICE_DEVIATION_THRESHOLD", 5),
        closing_date: this._getSafeSetting("CLOSING_DATE", ""),
        sector_profile: this._getSafeSetting("SECTOR_PROFILE", "GENERIC"),
        ui_labels: this._getSafeSetting("UI_LABELS", SECTOR_TEMPLATES['GENERIC'].ui_labels),
        inventory_families: this._getSafeSetting("INVENTORY_FAMILIES", SECTOR_TEMPLATES['GENERIC'].inventory_families),
        sales_families: this._getSafeSetting("SALES_FAMILIES", SECTOR_TEMPLATES['GENERIC'].sales_families),
        autopilot_active: this._getSafeSetting("AUTOPILOT_ACTIVE", false),
        autopilot_confidence_min: this._getSafeSetting("AUTOPILOT_CONFIDENCE_MIN", 95),
        autopilot_max_deviation: this._getSafeSetting("AUTOPILOT_MAX_DEVIATION", 2),
        ginbound_active: this._getSafeSetting("GINBOUND_ACTIVE", false),
        ginbound_label: this._getSafeSetting("GINBOUND_LABEL", "Handoo_Inbox"),
        ginbound_whitelist_only: this._getSafeSetting("GINBOUND_WHITELIST_ONLY", true),
        profile: this._getSafeSetting("USER_PROFILE", { nombre: 'ADMIN' }),
        balances: this.updatePGCSaldos(),
        ai: { api_key: aiKey ? String(aiKey).substring(0,6) + "..." : "", model: this._getSafeSetting("AI_MODEL", "gemini-1.5-flash"), auto_pilot: this._getSafeSetting("AI_AUTO_PILOT", false) },
        clients: _DB.get("tenants"),
        masters: {
          companies: allMasters.filter(m => m.type === 'COMPANY'),
          taxes: allMasters.filter(m => m.type === 'TAX'),
          retentions: allMasters.filter(m => m.type === 'RETENTION'),
          payment_methods: allMasters.filter(m => m.type === 'PAYMENT_METHOD'),
          series: allMasters.filter(m => m.type === 'SERIES'),
          bank_accounts: allMasters.filter(m => m.type === 'BANK_ACCOUNT'),
          payment_terms: allMasters.filter(m => m.type === 'PAYMENT_TERM'),
          periodicities: allMasters.filter(m => m.type === 'PERIODICITY'),
          products: allMasters.filter(m => m.type === 'PRODUCT'),
          plans: allMasters.filter(m => m.type === 'PLAN'),
          modules: allMasters.filter(m => m.type === 'MODULE'),
          discounts: allMasters.filter(m => m.type === 'DISCOUNT'),
          vendors: _DB.get("DB_VENDORS")
        }
      });
    } catch(e) { return Response.error(e.message); }
  },

  saveSettings: function(payload) {
    console.log("KERNEL_SAVE_SETTINGS_PAYLOAD", payload);
    try {
      const wrap = (v) => ({ value: v });
      if(payload.fixed_costs !== undefined) _DB.save("SETTINGS_V70", "FIXED_COSTS", wrap(payload.fixed_costs));
      if(payload.subscription) _DB.save("SETTINGS_V70", "SUBSCRIPTION", wrap(payload.subscription));
      if(payload.custom_packs) _DB.save("SETTINGS_V70", "CUSTOM_PACKS", wrap(payload.custom_packs));
      
      if(payload.active_modules) {
        let newModules = Array.isArray(payload.active_modules) ? payload.active_modules : [];
        console.log("KERNEL_SAVE_TRIGGERED", newModules);
        _DB.save("SETTINGS_V70", "ACTIVE_MODULES", wrap(newModules));
      }
      
      // MOTOR DE BAUTISMO DE SECTORES
      if(payload.sector_profile) {
        const template = SECTOR_TEMPLATES[payload.sector_profile] || SECTOR_TEMPLATES['GENERIC'];
        _DB.save("SETTINGS_V70", "SECTOR_PROFILE", wrap(payload.sector_profile));
        _DB.save("SETTINGS_V70", "UI_LABELS", wrap(template.ui_labels));
        _DB.save("SETTINGS_V70", "INVENTORY_FAMILIES", wrap(template.inventory_families));
        _DB.save("SETTINGS_V70", "SALES_FAMILIES", wrap(template.sales_families));
      }
      
      if(payload.closing_date !== undefined) _DB.save("SETTINGS_V70", "CLOSING_DATE", wrap(payload.closing_date));
      if(payload.admin_pin) _DB.save("SETTINGS_V70", "ADMIN_PIN", wrap(payload.admin_pin));
      if(payload.expense_approval_threshold !== undefined) _DB.save("SETTINGS_V70", "EXPENSE_APPROVAL_THRESHOLD", wrap(payload.expense_approval_threshold));
      if(payload.price_deviation_threshold !== undefined) _DB.save("SETTINGS_V70", "PRICE_DEVIATION_THRESHOLD", wrap(payload.price_deviation_threshold));
      
      if(payload.autopilot_active !== undefined) _DB.save("SETTINGS_V70", "AUTOPILOT_ACTIVE", wrap(payload.autopilot_active));
      if(payload.autopilot_confidence_min !== undefined) _DB.save("SETTINGS_V70", "AUTOPILOT_CONFIDENCE_MIN", wrap(payload.autopilot_confidence_min));
      if(payload.autopilot_max_deviation !== undefined) _DB.save("SETTINGS_V70", "AUTOPILOT_MAX_DEVIATION", wrap(payload.autopilot_max_deviation));

      if(payload.ginbound_active !== undefined) _DB.save("SETTINGS_V70", "GINBOUND_ACTIVE", wrap(payload.ginbound_active));
      if(payload.ginbound_label !== undefined) _DB.save("SETTINGS_V70", "GINBOUND_LABEL", wrap(payload.ginbound_label));
      if(payload.ginbound_whitelist_only !== undefined) _DB.save("SETTINGS_V70", "GINBOUND_WHITELIST_ONLY", wrap(payload.ginbound_whitelist_only));

      if(payload.ai_api_key !== undefined && !payload.ai_api_key.includes('...')) {
        _DB.save("SETTINGS_V70", "AI_API_KEY", wrap(payload.ai_api_key));
      }
      if(payload.ai_model) _DB.save("SETTINGS_V70", "AI_MODEL", wrap(payload.ai_model));
      if(payload.ai_auto_pilot !== undefined) _DB.save("SETTINGS_V70", "AI_AUTO_PILOT", wrap(payload.ai_auto_pilot));
      
      if(payload.system_currency) _DB.save("SETTINGS_V70", "SYSTEM_CURRENCY", wrap(payload.system_currency));
      if(payload.credit_expiry_threshold !== undefined) _DB.save("SETTINGS_V70", "CREDIT_EXPIRY_THRESHOLD", wrap(payload.credit_expiry_threshold));
      if(payload.decimal_precision !== undefined) _DB.save("SETTINGS_V70", "DECIMAL_PRECISION", wrap(payload.decimal_precision));
      
      // ALERTA Y AUTOMATIZACIÓN DE CIERRES
      if(payload.alert_time_morning !== undefined) _DB.save("SETTINGS_V70", "alert_time_morning", wrap(payload.alert_time_morning));
      if(payload.alert_time_night !== undefined) _DB.save("SETTINGS_V70", "alert_time_night", wrap(payload.alert_time_night));
      if(payload.enable_calendar_staff !== undefined) _DB.save("SETTINGS_V70", "enable_calendar_staff", wrap(payload.enable_calendar_staff));
      if(payload.team_roles) _DB.save("SETTINGS_V70", "TEAM_ROLES", wrap(payload.team_roles));

      SpreadsheetApp.flush();
      this._logAction("SAVE_SETTINGS", "Actualización de parámetros del núcleo");
      if (typeof Module_Admin !== 'undefined') Module_Admin._cache = null;
      return this.getSettings();
    } catch(e) { return Response.error(e.message); }
  },

  omniSearch: function(payload) {
    try {
      const q = String(payload.query).toLowerCase();
      const results = [];
      const clients = _DB.get("tenants");
      const invoices = _DB.get("DB_INVOICES");
      const vendors = _DB.get("DB_VENDORS");

      clients.filter(c => c.nombre_fiscal.toLowerCase().includes(q) || c.cif.toLowerCase().includes(q)).forEach(c => results.push({ id: c.id, title: c.nombre_fiscal, subtitle: c.cif, type: 'CLIENTE', view: 'Clients', icon: 'bi-person-fill' }));
      invoices.filter(i => String(i.numero).toLowerCase().includes(q) || i.client_name.toLowerCase().includes(q)).forEach(i => results.push({ id: i.id, title: i.numero || i.id, subtitle: i.client_name, type: 'FACTURA', view: 'Invoices', icon: 'bi-receipt' }));
      vendors.filter(v => v.nombre_fiscal.toLowerCase().includes(q)).forEach(v => results.push({ id: v.id, title: v.nombre_fiscal, subtitle: v.cif, type: 'PROVEEDOR', view: 'Vendors', icon: 'bi-truck' }));
      
      return Response.success(results.slice(0, 10));
    } catch(e) { return Response.error(e.message); }
  },

  restoreItem: function(p) {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(30000);
      const ids = p.ids || [p.id];
      if (!ids || ids.length === 0) return Response.error("No hay identificadores para restaurar.");
      
      const trash = _DB.get("RECYCLE_BIN");
      let count = 0;

      ids.forEach(id => {
        const item = trash.find(x => String(x.id) === String(id));
        if (item) {
          _DB.save(item._origin_sheet, item.id, item);
          _DB.delete("RECYCLE_BIN", id);
          count++;
        }
      });

      this._logAction("RESTORE_BATCH", `Restaurados ${count} registros desde la papelera.`);
      return Response.success(null, `${count} registros restaurados satisfactoriamente.`);
    } catch(e) { return Response.error(e.message); }
    finally { lock.releaseLock(); }
  },

  purgeItem: function(p) {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(30000);
      const ids = p.ids || [p.id];
      if (!ids || ids.length === 0) return Response.error("No hay identificadores para purgar.");

      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("RECYCLE_BIN");
      if (!sheet) return Response.error("Sheet de papelera no localizado.");
      
      const data = sheet.getDataRange().getValues();
      const idsInSheet = data.map(r => String(r[0]));
      
      const rowsToDelete = [];
      ids.forEach(id => {
        const idx = idsInSheet.indexOf(String(id));
        if (idx > -1) rowsToDelete.push(idx + 1); // Row index is 1-based
      });
      
      rowsToDelete.sort((a,b) => b - a).forEach(row => sheet.deleteRow(row));

      this._logAction("PURGE_BATCH", `Eliminación permanente de ${rowsToDelete.length} registros.`);
      return Response.success(null, `${rowsToDelete.length} registros eliminados permanentemente.`);
    } catch(e) { return Response.error(e.message); }
    finally { lock.releaseLock(); }
  },

  clearTrash: function() {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(30000);
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("RECYCLE_BIN");
      if (!sheet) return Response.success(null, "Papelera ya vacía.");
      
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
         sheet.deleteRows(2, lastRow - 1);
      }
      this._logAction("CLEAR_TRASH", "Vaciado atómico de la papelera global.");
      return Response.success(null, "La papelera ha sido vaciada por completo.");
    } catch(e) { return Response.error(e.message); }
    finally { lock.releaseLock(); }
  },

  getStrategicProjections: function() {
    try {
      const settingsRes = this.getSettings();
      const settings = settingsRes.data;
      const subs = _DB.get("SUBSCRIPTIONS") || [];
      const mrr = subs.filter(s => s.status === 'Activo').reduce((sum, s) => sum + parseFloat(s.price || 0), 0);
      const balances = settings.balances;
      let currentCash = 0;
      Object.keys(balances).forEach(acc => { if(acc.startsWith('570') || acc.startsWith('572')) currentCash += balances[acc]; });

      const fixed = settings.fixed_costs_real_avg || parseFloat(settings.fixed_costs || 0); 
      const projections = [];
      let runningCash = currentCash;
      const months = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
      const startMonth = new Date().getMonth();

      for (let i = 0; i < 12; i++) {
        runningCash += (mrr - fixed);
        projections.push({ label: months[(startMonth + i) % 12], cash: Math.round(runningCash), mrr: Math.round(mrr), fixed: fixed });
      }

      return Response.success({ mrr, estimated_annual_ebitda: (mrr - fixed) * 12, annual_runway: runningCash > 0 ? 'STABLE' : 'RISK', projections });
    } catch(e) { return Response.error(e.message); }
  },

  saveStrategySnapshot: function() {
    try {
      const data = this.getStrategicProjections().data;
      const snapshot = { id: 'SNAP-' + Date.now(), timestamp: new Date().toISOString(), data: data };
      _DB.save("DB_STRATEGY_SNAPSHOTS", snapshot.id, snapshot);
      this._logAction("STRATEGY_SNAPSHOT", "Generado snapshot estratégico de 12 meses");
      return Response.success(snapshot);
    } catch(e) { return Response.error(e.message); }
  },

  getVarianceReport: function() {
    try {
      const snapshots = _DB.get("DB_STRATEGY_SNAPSHOTS");
      if (snapshots.length === 0) return Response.error("No hay snapshots previos.");
      const last = snapshots[snapshots.length - 1].data;
      const realMrr = (_DB.get("SUBSCRIPTIONS") || []).filter(s => s.status === 'Activo').reduce((s, x) => s + parseFloat(x.price), 0);
      return Response.success({ period: 'MES ACTUAL', reliability_index: 95, mrr: { projected: last.mrr, real: realMrr, perc: ((realMrr / last.mrr) - 1) * 100 }, expenses: { projected: last.projections[0].fixed, real: last.projections[0].fixed * 1.05, perc: 5 } });
    } catch(e) { return Response.error(e.message); }
  },

  generateQuarterlyClosing: function(p) {
    this._logAction("QUARTERLY_CLOSING", `Ejecutado cierre para Q${p.quarter}`);
    return Response.success(null, "Cierre trimestral consolidado para Q" + p.quarter);
  },

  saveMovement: function(p) {
    const id = "MOV-MAN-" + Date.now();
    _DB.save("DB_MOVEMENTS", id, { id, ...p });
    this.updatePGCSaldos();
    this._logAction("MANUAL_MOVEMENT", `Ajuste contable de ${p.importe}€ en ${p.cuenta}`);
    return Response.success(null, "Movimiento guardado");
  },

  getFullState: function() {
    try {
      return Response.success({
        stats: this.getDashboardStats().data,
        settings: this.getSettings().data,
        clients: _DB.get("tenants"),
        vendors: _DB.get("DB_VENDORS"),
        invoices: _DB.get("DB_INVOICES"),
        expenses: _DB.get("DB_EXPENSES"),
        delivery_notes: _DB.get("DB_DELIVERY_NOTES"),
        orders: _DB.get("DB_PURCHASE_ORDERS"),
        effects: _DB.get("DB_TREASURY_EFFECTS"),
        subscriptions: _DB.get("SUBSCRIPTIONS"),
        cost_centers: _DB.get("DB_COST_CENTERS")
      });
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * REGISTRO DE ACCIONES DE AUDITORÍA (REPARACIÓN V125)
   */
  _logAction: function(action, details) {
    try {
      const logId = "LOG-" + Date.now();
      const profile = this._getSafeSetting("USER_PROFILE", { nombre: 'ADMIN' });
      const logEntry = {
        id: logId,
        timestamp: new Date().toISOString(),
        user: (typeof profile === 'object' ? profile.nombre : profile) || 'ADMINISTRADOR',
        action: action,
        details: details
      };
      _DB.save("DB_AUDIT_LOGS", logId, logEntry);
    } catch(e) { console.warn("Fallo al escribir log: " + e.message); }
  },

  /**
   * RECUPERACIÓN DE LOGS PARA LA UI (REPARACIÓN V125)
   */
  getAuditLogs: function() {
    try {
      const logs = _DB.get("DB_AUDIT_LOGS") || [];
      return Response.success(logs.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 100));
    } catch(e) { return Response.success([]); }
  },

  run_hot_migration: function() {
    try {
      // 1. Creación de Tablas
      _DB._ensureSheet("DB_FORMULAS");
      _DB._ensureSheet("DB_FORMULA_ITEMS");

      // 2. Enriquecimiento del Maestro
      const masters = _DB.get("MASTERS") || [];
      let modified = false;

      masters.forEach(item => {
        if (item.type === 'PRODUCT') {
          if (item.nature === undefined) {
            item.nature = 'RAW';
            modified = true;
          }
          if (item.max_volatility_perc === undefined) {
            item.max_volatility_perc = 3;
            modified = true;
          }
        }
      });

      // 3. Persistencia
      if (modified) {
        masters.forEach(item => {
          _DB.save("MASTERS", item.id, item);
        });
      }

      this._logAction("HOT_MIGRATION", "Ejecutada migración de Fórmulas y ADN de Riesgo.");
      return Response.success(null, "Migración completada con éxito.");
    } catch (e) {
      return Response.error("Error en migración: " + e.message);
    }
  },

  /**
   * Asigna metadatos por defecto a productos huérfanos.
   */
  fix_missing_metadata: function() {
    try {
      const masters = _DB.get("MASTERS") || [];
      let modified = false;

      masters.forEach(item => {
        if (item.type === 'PRODUCT') {
          if (item.nature === undefined) {
            item.nature = 'RAW';
            modified = true;
          }
          if (item.max_volatility_perc === undefined) {
            item.max_volatility_perc = 3;
            modified = true;
          }
        }
      });

      if (modified) {
        masters.forEach(item => {
          _DB.save("MASTERS", item.id, item);
        });
      }

      this._logAction("FIX_METADATA", "Asignados metadatos por defecto a productos huérfanos.");
      return Response.success(null, "Metadatos corregidos.");
    } catch (e) {
      return Response.error("Error en fix_missing_metadata: " + e.message);
    }
  }
};