/**
 * Vendor_Controller.gs - TITANIUM V2.3.1
 */
var Vendor_Controller = {
  
  list: function() {
    try {
      return Response.success(_DB.get("DB_VENDORS") || []);
    } catch(e) { return Response.error(e.message); }
  },

  findByName: function(name) {
    if (!name) return null;
    const vendors = _DB.get("DB_VENDORS") || [];
    const search = String(name).toUpperCase().trim();
    return vendors.find(v => String(v.nombre_fiscal).toUpperCase().trim() === search);
  },

  save: function(payload) {
    try {
      if (!payload.nombre_fiscal || !payload.cif) return Response.error("Razón Social y CIF requeridos.");
      
      const isNew = (!payload.id || payload.id === 'new');
      payload.nombre_fiscal = String(payload.nombre_fiscal).toUpperCase().trim();
      payload.cif = String(payload.cif).toUpperCase().trim();

      // VALIDACIÓN ALGORÍTMICA DE IBAN (MOD 97) PARA PROVEEDORES
      if (payload.facturacion?.iban) {
         const cleanIBAN = String(payload.facturacion.iban).replace(/\s/g, '').toUpperCase();
         if (!Masters_Controller._isValidIBAN(cleanIBAN)) {
            return Response.error(`IDENTIFICADOR INVÁLIDO: El IBAN del proveedor no supera el algoritmo de validación bancaria.`);
         }
      }

      // Validación de duplicidad de CIF (Excepto si es PENDIENTE para permitir ingestas múltiples)
      if (payload.cif !== 'PENDIENTE') {
        if (!_DB.isUnique("DB_VENDORS", "cif", payload.cif, isNew ? null : payload.id)) {
          return Response.error(`IDENTIFICADOR DUPLICADO: El CIF ${payload.cif} ya existe en el Kernel de proveedores.`);
        }
      }

      if (isNew) {
        payload.id = _DB.getNextSequentialId("DB_VENDORS", "PRV");
        payload.fecha_alta = new Date().toISOString();
        payload.estado = payload.status || 'CUARENTENA';
        if(!payload.price_memory) payload.price_memory = {};
      }

      _DB.save("DB_VENDORS", payload.id, payload);
      return Response.success(payload, "Proveedor sincronizado.");
    } catch ( e ) { return Response.error(e.message); }
  },

  delete: function(payload) {
    try {
      // BLINDAJE DE INTEGRIDAD REFERENCIAL (Consigna V100)
      const effects = _DB.get("DB_TREASURY_EFFECTS") || [];
      const movements = _DB.get("DB_MOVEMENTS") || [];
      const expenses = _DB.get("DB_EXPENSES") || [];
      
      const hasEffects = effects.some(e => String(e.vendor_id || '') === String(payload.id));
      const hasMovements = movements.some(m => String(m.ref_id || '').includes(payload.id));
      const hasExpenses = expenses.some(ex => String(ex.vendor_id || '') === String(payload.id));

      if(hasEffects || hasMovements || hasExpenses) {
        return Response.error(`Integridad Protegida: No se puede eliminar un registro con movimientos vinculados o historial contable.`);
      }
      
      const ok = _DB.moveToTrash("DB_VENDORS", payload.id);
      return ok ? Response.success(null, "Expediente de proveedor movido a papelera.") : Response.error("Error DB Kernel: El identificador ya no existe o el sistema está bloqueado.");
    } catch (e) { return Response.error(e.message); }
  },

  getHistory: function(payload) {
    const all = _DB.get("DB_EXPENSES") || [];
    return Response.success(all.filter(e => String(e.vendor_id) === String(payload.vendor_id)));
  }
};