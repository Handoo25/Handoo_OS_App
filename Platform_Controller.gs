/**
 * Platform_Controller.gs - TITANIUM V74
 * Capa de API para la gestión de Clientes.
 */
var Platform_Controller = {
  
  list: function() {
    try {
      const clients = _DB.get("tenants") || [];
      return Response.success(clients);
    } catch(e) { return Response.error(e.message); }
  },

  save: function(client) {
    try {
      if (!client.nombre_fiscal || !client.cif) {
        return Response.error("Los campos Razón Social y CIF son mandatorios.");
      }

      // VALIDACIÓN ALGORÍTMICA DE IBAN (MOD 97) PARA CLIENTES
      if (client.bancos && client.bancos.length > 0) {
         for (const bank of client.bancos) {
            const cleanIBAN = String(bank.iban).replace(/\s/g, '').toUpperCase();
            if (!Masters_Controller._isValidIBAN(cleanIBAN)) {
               return Response.error(`IDENTIFICADOR INVÁLIDO: El IBAN ${bank.iban} no supera el algoritmo de validación bancaria.`);
            }
         }
      }

      // BLINDAJE V131: Validación algorítmica de IBAN en SEDES
      if (client.sedes && client.sedes.length > 0) {
         for (const sede of client.sedes) {
            if (sede.facturacion?.iban) {
               const cleanIBAN = String(sede.facturacion.iban).replace(/\s/g, '').toUpperCase();
               if (!Masters_Controller._isValidIBAN(cleanIBAN)) {
                  return Response.error(`IDENTIFICADOR INVÁLIDO EN SEDE: El IBAN de la sede ${sede.nombre} no supera el algoritmo de validación bancaria.`);
               }
            }
         }
      }

      const isNew = (!client.id || client.id === 'new');
      client.nombre_fiscal = String(client.nombre_fiscal).trim().toUpperCase();
      client.cif = String(client.cif).trim().toUpperCase();

      // Validación de duplicados delegada
      if (!_DB.isUnique("tenants", "cif", client.cif, isNew ? null : client.id)) {
        return Response.error(`IDENTIFICADOR DUPLICADO: El CIF ${client.cif} ya existe en el Kernel.`);
      }

      if (isNew) {
        const nextId = _DB.getNextSequentialId("tenants", "CLI");
        client.id = nextId;
        const numericPart = nextId.split('-')[1];
        client.cuenta_contable = "430" + numericPart.padStart(6, '0');
        client.fecha_alta = new Date().toISOString();
      }

      _DB.save("tenants", client.id, client);
      SpreadsheetApp.flush();
      
      return Response.success(client, "Expediente sincronizado correctamente.");
    } catch ( e ) { return Response.error(e.message); }
  },

  delete: function(payload) {
    try {
      const integrity = Module_Platform.checkIntegrity(payload.id);
      if (!integrity.safe) {
        return Response.error(`Fallo de Integridad: El cliente tiene ${integrity.details.invs} facturas y ${integrity.details.subs} licencias activas.`);
      }

      const ok = _DB.moveToTrash("tenants", payload.id);
      return ok ? Response.success(null, "Expediente movido a papelera.") : Response.error("Error en DB");
    } catch(e) { return Response.error(e.message); }
  },

  listTrash: function() {
    try {
      // Devolvemos toda la papelera sin filtrar para que sea global
      const trash = _DB.get("RECYCLE_BIN") || [];
      return Response.success(trash);
    } catch(e) { return Response.error(e.message); }
  }
};