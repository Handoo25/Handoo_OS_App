/**
 * Module_GInbound.gs - TITANIUM G-INBOUND ENGINE V210.0
 * Gestiona la ingesta desatendida desde Gmail/Workspace.
 */

var Module_GInbound = {

  /**
   * Escanea la bandeja de entrada buscando hilos sin leer con la etiqueta configurada.
   */
  scanGmailInbox: function() {
    try {
      const settings = Admin_Controller.getSettings().data;
      if (!settings.ginbound_active) return Response.error("G-Inbound desactivado en Kernel.");

      const labelName = settings.ginbound_label || "Handoo_Inbox";
      const whitelistOnly = settings.ginbound_whitelist_only;
      const vendors = _DB.get("DB_VENDORS") || [];
      
      const threads = GmailApp.search(`label:${labelName} is:unread`);
      let processedCount = 0;
      let ignoredCount = 0;

      threads.forEach(thread => {
        const messages = thread.getMessages();
        const msg = messages[messages.length - 1]; // Procesar el último mensaje del hilo
        const attachments = msg.getAttachments();
        const sender = msg.getFrom();

        attachments.forEach(attachment => {
          const contentType = attachment.getContentType();
          // Solo procesar PDF o Imágenes
          if (contentType.includes('pdf') || contentType.includes('image')) {
            const base64 = Utilities.base64Encode(attachment.getBytes());
            const dataUri = `data:${contentType};base64,${base64}`;

            // 1. LLAMADA AL MOTOR NEURAL (Bypass UI)
            const ocrRes = AI_Controller.processDocument({ 
              base64: dataUri, 
              mime: contentType, 
              fileName: attachment.getName() 
            });

            if (ocrRes.ok) {
              const data = ocrRes.data;
              
              // 2. VALIDACIÓN DE LISTA BLANCA
              let isWhitelisted = true;
              if (whitelistOnly) {
                isWhitelisted = vendors.some(v => 
                  String(v.cif).toUpperCase().trim() === String(data.vendor_cif).toUpperCase().trim() ||
                  String(v.nombre_fiscal).toUpperCase().trim() === String(data.vendor).toUpperCase().trim()
                );
              }

              if (isWhitelisted) {
                // 3. INYECTAR EN GASTOS
                const expensePayload = {
                  ...data,
                  type: data.detected_type || 'INVOICE',
                  beneficiario: data.vendor,
                  invoice_num: data.doc_num,
                  base64: dataUri,
                  fileName: attachment.getName(),
                  mimeType: contentType,
                  status: 'PENDIENTE',
                  obs: `[G-INBOUND] Capturado automáticamente de: ${sender}`
                };
                
                Expense_Controller.save(expensePayload);
                processedCount++;
              } else {
                ignoredCount++;
                console.warn(`G-Inbound: Remitente ${sender} no está en lista blanca. Ignorando.`);
              }
            }
          }
        });

        // Marcar como leído y archivar para evitar bucles
        msg.markRead();
        thread.removeLabel(GmailApp.getUserLabelByName(labelName));
        const processedLabel = this._getOrCreateLabel("Handoo_Procesado");
        thread.addLabel(processedLabel);
      });

      return Response.success(null, `G-Inbound: ${processedCount} facturas succionadas con éxito. ${ignoredCount} ignoradas por seguridad.`);
    } catch(e) {
      return Response.error("Fallo motor G-Inbound: " + e.message);
    }
  },

  _getOrCreateLabel: function(name) {
    let label = GmailApp.getUserLabelByName(name);
    if (!label) label = GmailApp.createLabel(name);
    return label;
  }
};