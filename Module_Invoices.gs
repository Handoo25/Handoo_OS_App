/**
 * Module_Invoices.gs - TITANIUM V1.3 (HANDOO NETWORK EXTENSION)
 */
var Module_Invoices = {

  approveAndDistribute: function(payload) {
    try {
      const draftIds = payload.ids || [];
      const allInvoices = _DB.get("DB_INVOICES") || [];
      const masters = _DB.get("MASTERS") || [];
      const clients = _DB.get("tenants") || [];
      const series = masters.filter(m => m.type === 'SERIES');
      const activeSerie = series.find(s => s.favorita === true) || series[0] || { prefijo: 'FAC', inicio: 1 };
      let processedCount = 0;

      for (const id of draftIds) {
        const draft = allInvoices.find(i => i.id === id);
        if (!draft || draft.status !== 'DRAFT') continue;
        const client = clients.find(c => c.id === draft.client_id);
        
        // Bloqueo de seguridad preventivo
        if (client?.bloqueado_impago) throw new Error(`OPERATIVA RESTRINGIDA: El cliente ${client.nombre_fiscal} tiene bloqueos por impago. Resuelva la deuda antes de emitir.`);

        const now = new Date();
        const prefix = (activeSerie.prefijo || 'FAC') + String(now.getMonth() + 1).padStart(2, '0');
        const issuedInvs = _DB.get("DB_INVOICES").filter(i => String(i.numero).startsWith(prefix));
        const nextSeq = issuedInvs.length > 0 ? Math.max(...issuedInvs.map(i => parseInt(String(i.numero).replace(prefix, '')) || 0)) + 1 : (parseInt(activeSerie.inicio) || 1);
        const realNumber = prefix + String(nextSeq).padStart(4, '0');

        const oldId = draft.id;
        draft.numero = realNumber;
        draft.id = realNumber; 
        draft.status = 'ISSUED';
        draft.fecha_emision = now.toISOString();
        
        // LIMPIEZA ATÓMICA DE IDS (PROTECCIÓN V208.2) - Crucial para evitar duplicados en el Spreadsheet
        if (String(oldId) !== String(draft.id)) { 
          _DB.delete("DB_INVOICES", oldId); 
        }
        _DB.save("DB_INVOICES", draft.id, draft);

        // Distribución de Efectos en Tesorería
        const totalAmount = parseFloat(draft.total || 0);
        const effectId = _DB.getNextSequentialId("DB_TREASURY_EFFECTS", "EFE");
        _DB.save("DB_TREASURY_EFFECTS", effectId, {
          id: effectId, invoice_id: draft.id, client_id: draft.client_id, client_name: draft.client_name,
          vencimiento: draft.fecha_vencimiento || now.toISOString().split('T')[0], importe: totalAmount,
          status: 'PENDIENTE', metodo: draft.forma_pago_override || client.facturacion?.forma_pago || 'TRANSFERENCIA',
          created_at: new Date().toISOString()
        });

        // --- PROTOCOLO DE RED HANDOO (MÉTODO ESPEJO) ---
        if (client && client.handoo_network === true) {
           Module_Network.dispatchMirrorInvoice(draft, client);
        }

        processedCount++;
      }
      SpreadsheetApp.flush(); 
      Admin_Controller.updatePGCSaldos();
      return Response.success(null, `Sincronización Exitosa: Se han emitido ${processedCount} facturas oficiales.`);
    } catch (e) { return Response.error(e.message); }
  } 
};