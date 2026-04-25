/**
 * Masters_Controller.gs - TITANIUM V6.1.1
 * Gestión desacoplada de tablas maestras y diccionarios del Kernel.
 */
var Masters_Controller = {

  listByType: function(type) {
    try {
      const all = _DB.get("MASTERS") || [];
      return Response.success(all.filter(m => m.type === type));
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * Guarda o actualiza un registro maestro.
   * Soporta tipos administrativos: COMPANY, TAX, RETENTION, SERIES, BANK_ACCOUNT, PAYMENT_METHOD, PERIODICITY, PAYMENT_TERM.
   */
  /**
   * Guarda o actualiza un registro maestro.
   * V310: Soporte para Taxonomía de Inventario (RAW, ELB, VTA, SUM).
   */
  save: function(payload) {
    try {
      const m = payload.master || payload; 
      if (!m.type) return Response.error("Tipo de maestro no definido.");

      // 1. Generación de ID si es nuevo
      if (!m.id || m.id === 'new') {
        const prefixes = { 
          // Administrativos
          'COMPANY': 'COM', 'TAX': 'IVA', 
          'RETENTION': 'RET', 'SERIES': 'SER', 'BANK_ACCOUNT': 'BNK',
          'PAYMENT_METHOD': 'PAY', 'PERIODICITY': 'PER', 'PAYMENT_TERM': 'TRM',
          
          // Inventario (NUEVOS TIPOS V310)
          'RAW': 'MAT',           // Materia Prima
          'SEMIFINISHED': 'ELB',  // Elaboración / Semi
          'FINAL_PRODUCT': 'VTA', // Venta / Final
          'SUPPLY': 'SUM',        // Suministro
          'PRODUCT': 'PRD',       // Genérico (Legacy)
          'MODULE': 'MOD',        // Módulo ERP
          'PLAN': 'PLN',          // Plan
          'DISCOUNT': 'DTO'       // Descuento
        };
        const prefix = prefixes[m.type] || 'MST';
        m.id = _DB.getNextSequentialId("MASTERS", prefix);
      }

      // 2. Lógica específica por tipo
      if (m.type === 'COMPANY' && m.favorita === true) {
        this._clearOtherFavorites('COMPANY', m.id);
      }

      if (m.type === 'BANK_ACCOUNT') {
        // Validación IBAN (se mantiene igual que tu código original)
        const cleanIBAN = String(m.iban || '').replace(/\s/g, '').toUpperCase();
        if (!m.is_credit_line && !this._isValidIBAN(cleanIBAN)) {
          return Response.error(`IDENTIFICADOR INVÁLIDO: El IBAN ${m.iban} no supera el algoritmo.`);
        }
        // ... (resto de validaciones de banco se mantienen)
        if (!m.pgc_root) m.pgc_root = '572';
      }

      if (m.type === 'PAYMENT_TERM') {
        if (m.dias_input) {
             m.dias = String(m.dias_input).split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
             delete m.dias_input;
        }
        if (!Array.isArray(m.dias)) m.dias = [30];
        m.plazos = m.dias;
      }

      // 3. Lógica Contable PGC
      if (m.pgc_root && m.pgc_root.length === 3) {
        const currentRoot = m.ref_contable ? String(m.ref_contable).substring(0,3) : '';
        if (!m.ref_contable || currentRoot !== m.pgc_root) {
           m.ref_contable = _DB.getNextSubAccount(m.pgc_root);
        }
      }

      // 4. Persistencia Atómica
      _DB.save("MASTERS", m.id, m);
      SpreadsheetApp.flush();

      return Response.success(m, "Maestro sincronizado correctamente.");
    } catch (e) { return Response.error("FALLO KERNEL MAESTROS: " + e.message); }
  },
  quickSave: function(payload) {
    try {
      const type = payload.type || 'MST';
      const item = {
        id: 'new',
        type: type,
        nombre: String(payload.nombre || '').toUpperCase(),
        created_at: new Date().toISOString()
      };
      return this.save(item);
    } catch (e) { return Response.error(e.message); }
  },

  _clearOtherFavorites: function(type, currentId) {
    const all = _DB.get("MASTERS") || [];
    all.forEach(item => {
      if (item.type === type && item.id !== currentId && item.favorita === true) {
        item.favorita = false;
        _DB.save("MASTERS", item.id, item);
      }
    });
  },
  /* --- AÑADIR ESTO EN Admin_Controller o Masters_Controller --- */
  updateSalesFamilies: function(families) {
    try {
      const settings = _DB.get("SETTINGS") || {};
      // Aseguramos la estructura
      if (!settings.masters) settings.masters = {};
      
      // Guardamos la nueva lista
      settings.masters.sales_families = families;
      
      // Persistimos en base de datos (ID 'global' para settings)
      _DB.save("SETTINGS", "global", settings);
      
      return Response.success(families, "Familias actualizadas");
    } catch(e) { return Response.error(e.message); }
  },
  /**
   * Validador Algorítmico de IBAN (ISO 13616)
   */
  _isValidIBAN: function(iban) {
    const clean = iban.replace(/\s/g, '').toUpperCase();
    if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{4,30}$/.test(clean)) return false;

    // Mover primeros 4 caracteres al final
    const rearranged = clean.slice(4) + clean.slice(0, 4);
    
    // Convertir letras a dígitos (A=10, B=11... Z=35)
    const numeric = rearranged.split('').map(c => {
      const code = c.charCodeAt(0);
      return code >= 65 && code <= 90 ? (code - 55).toString() : c;
    }).join('');

    // Procesar por bloques de 7 dígitos para evitar pérdida de precisión de enteros en mod 97
    let remainder = numeric;
    while (remainder.length > 2) {
      let block = remainder.slice(0, 9);
      remainder = (parseInt(block, 10) % 97).toString() + remainder.slice(block.length);
    }
    return parseInt(remainder, 10) % 97 === 1;
  }
};