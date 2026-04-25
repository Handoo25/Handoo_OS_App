/**
 * Invoice_Controller.gs - TITANIUM V104.0 (BULK OPTIMIZED)
 */
var Invoice_Controller = {
  STATUS_DRAFT: 'DRAFT',
  STATUS_ISSUED: 'ISSUED',

  list: function() {
    return Response.success(_DB.get("DB_INVOICES"));
  },

  listDrafts: function(payload) {
    const locationId = payload?.locationId;
    const all = _DB.get("DB_INVOICES") || [];
    let filtered = all.filter(i => i.status === this.STATUS_DRAFT);
    
    // FILTRO QUIRÚRGICO POR SEDE
    if (locationId && locationId !== 'GLOBAL') {
      filtered = filtered.filter(i => String(i.sede_id) === String(locationId));
    }
    
    return Response.success(filtered);
  },

  listHistory: function(payload) {
    const locationId = payload?.locationId;
    const all = _DB.get("DB_INVOICES") || [];
    let filtered = all.filter(i => i.status === this.STATUS_ISSUED);
    
    // FILTRO QUIRÚRGICO POR SEDE
    if (locationId && locationId !== 'GLOBAL') {
      filtered = filtered.filter(i => String(i.sede_id) === String(locationId));
    }
    
    return Response.success(filtered);
  },

  getByClient: function(payload) {
    try {
      if (!payload.client_id) return Response.error("ID de cliente requerido");
      const all = _DB.get("DB_INVOICES") || [];
      const filtered = all.filter(i => String(i.client_id) === String(payload.client_id) && i.status === this.STATUS_ISSUED);
      return Response.success(filtered);
    } catch (e) { return Response.error(e.message); }
  },

  generateDraftsBatch: function() {
    try {
      const today = new Date();
      today.setHours(0,0,0,0);
      const subs = _DB.get("SUBSCRIPTIONS") || [];
      const clients = _DB.get("tenants") || [];
      const draftsGenerated = [];

      const pendingSubs = subs.filter(s => {
        if (s.status !== 'Activo') return false;
        if (!s.next_billing) return false;
        const nextDate = new Date(s.next_billing);
        return nextDate <= today;
      });

      pendingSubs.forEach(s => {
        const client = clients.find(c => c.id === s.client_id);
        if (!client) return;

        const draftId = "DFT-" + Date.now() + "-" + s.id;
        const base = parseFloat(s.price || 0);
        const ivaPerc = parseFloat(client.facturacion.tipo_impuesto_valor || 21);
        const iva = base * (ivaPerc / 100);
        const total = base + iva;

        const draft = {
          id: draftId,
          subscription_id: s.id,
          client_id: s.client_id,
          client_name: client.nombre_fiscal,
          sede_id: s.sede_id,
          item_display_name: s.item_display_name || 'LICENCIA RECURRENTE',
          base: base,
          total_iva: iva,
          total: total,
          status: this.STATUS_DRAFT,
          fecha: new Date().toISOString().split('T')[0],
          moneda: client.moneda || 'EUR'
        };

        _DB.save("DB_INVOICES", draft.id, draft);
        draftsGenerated.push(draft);
      });

      return Response.success(draftsGenerated, `Se han generado ${draftsGenerated.length} borradores.`);
    } catch (e) { return Response.error(e.message); }
  },

  approveDrafts: function(payload) {
    const res = Module_Invoices.approveAndDistribute(payload);
    if(res.ok) {
      return Response.success(null, "Efectos de cobro generados y factura emitida.");
    }
    return res;
  },

  sendBatchEmails: function(payload) {
    try {
      let idsToProcess = [];
      if (Array.isArray(payload.ids)) idsToProcess = payload.ids;
      else if (payload.id) idsToProcess = [payload.id];
      
      if (idsToProcess.length === 0) return Response.error("No se han seleccionado facturas.");

      const allInvoices = _DB.get("DB_INVOICES") || [];
      const allClients = _DB.get("tenants") || [];
      const settingsRaw = Admin_Controller.getSettings();
      const settings = settingsRaw.data || settingsRaw;
      const issuer = settings.masters.companies.find(c => c.favorita) || settings.masters.companies[0] || {};
      
      let successCount = 0;
      let errorCount = 0;
      let logDetails = [];

      idsToProcess.forEach(id => {
        const inv = allInvoices.find(i => i.id === id);
        if (!inv || inv.status !== this.STATUS_ISSUED) {
          logDetails.push(`Fac ${id}: No encontrada o no emitida`);
          errorCount++;
          return;
        }

        const client = allClients.find(c => c.id === inv.client_id);
        if (!client) {
          logDetails.push(`Fac ${inv.numero}: Cliente desconocido`);
          errorCount++;
          return;
        }

        let targetEmail = "";
        if (client.comercial && client.comercial.email_facturacion) targetEmail = client.comercial.email_facturacion;
        else if (client.comercial && client.comercial.email_contacto) targetEmail = client.comercial.email_contacto;

        if (!targetEmail || targetEmail.indexOf("@") === -1) {
          logDetails.push(`Fac ${inv.numero}: Cliente sin email válido`);
          errorCount++;
          return;
        }

        let pdfBlob;
        try {
          if (inv.drive_id) {
            pdfBlob = DriveApp.getFileById(inv.drive_id).getBlob();
          } else {
            const pdfResult = this.getPDF({ id: inv.id });
            if (pdfResult.ok && pdfResult.data.url) {
               const freshInv = _DB.get("DB_INVOICES").find(i => i.id === id);
               pdfBlob = DriveApp.getFileById(freshInv.drive_id).getBlob();
            } else {
               throw new Error("Fallo al generar PDF");
            }
          }
        } catch (e) {
          logDetails.push(`Fac ${inv.numero}: Error PDF (${e.message})`);
          errorCount++;
          return;
        }

        const subject = `Factura ${inv.numero} - ${issuer.nombre_fiscal || 'HANDOO'}`;
        const bodyHTML = `
          <div style="font-family: Arial, sans-serif; color: #333; padding: 20px;">
            <h3 style="color: #0f172a;">Hola, ${client.nombre_fiscal}</h3>
            <p>Adjuntamos su factura <strong>${inv.numero}</strong>.</p>
            <ul style="background: #f1f5f9; padding: 15px; list-style: none; border-radius: 8px;">
              <li><strong>Importe:</strong> ${parseFloat(inv.total).toLocaleString('es-ES', {minimumFractionDigits: 2})} €</li>
              <li><strong>Fecha:</strong> ${new Date(inv.fecha).toLocaleDateString('es-ES')}</li>
            </ul>
            <p>Gracias por su confianza.</p>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
            <small style="color: #64748b;">${issuer.nombre_fiscal || 'Departamento de Facturación'}</small>
          </div>
        `;

        GmailApp.sendEmail(targetEmail, subject, "Su cliente de correo no soporta HTML. Ver adjunto.", {
          htmlBody: bodyHTML,
          attachments: [pdfBlob],
          name: issuer.nombre_fiscal || 'Facturación'
        });

        inv.email_sent = true;
        inv.last_email_date = new Date().toISOString();
        _DB.save("DB_INVOICES", inv.id, inv);
        successCount++;
      });

      const message = `Enviados: ${successCount}. Fallidos: ${errorCount}. ${errorCount > 0 ? logDetails.join(', ') : ''}`;
      return Response.success({ success: successCount, errors: errorCount }, message);

    } catch (e) { return Response.error(e.message); }
  },

  getPDF: function(payload) {
    try {
      const invoices = _DB.get("DB_INVOICES") || [];
      const inv = invoices.find(i => i.id === payload.id);
      if (!inv) return Response.error("Factura no encontrada");

      const clients = _DB.get("tenants") || [];
      const client = clients.find(c => c.id === inv.client_id);
      
      const settingsRaw = Admin_Controller.getSettings(); 
      const settings = settingsRaw.data || settingsRaw;

      const html = this._getInvoiceHTML(inv, client, settings);
      const blob = Utilities.newBlob(html, 'text/html', 'temp.html').getAs('application/pdf');
      
      let folder;
      const folders = DriveApp.getFoldersByName("HANDOO_INVOICES");
      if (folders.hasNext()) folder = folders.next();
      else folder = DriveApp.createFolder("HANDOO_INVOICES");

      const name = `${inv.numero || inv.id}_${(client.nombre_fiscal || 'CLIENTE').replace(/\s+/g, '_')}.pdf`;
      const file = folder.createFile(blob).setName(name);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      
      const url = file.getUrl();
      inv.pdf_url = url;
      inv.drive_id = file.getId();
      
      _DB.save("DB_INVOICES", inv.id, inv);
      return Response.success({ url: url });
    } catch(e) { return Response.error(e.message); }
  },

  _getInvoiceHTML: function(inv, client, settings) {
    const issuer = settings.masters.companies.find(c => c.favorita) || settings.masters.companies[0] || {};
    const currency = settings.system_currency || 'EUR';
    const fmt = (v) => parseFloat(v || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 }) + (currency === 'EUR' ? ' €' : ' $');
    
    const formatAddress = (addr, root) => {
      const d = (typeof addr === 'object' && addr !== null) ? addr : {};
      const calle = d.nombre || d.calle || '';
      const num = d.num || '';
      const cp = d.cp || '';
      const pob = d.pob || ''; // <--- Ahora vendrá de la lista oficial GEO_DATA
      const prov = d.prov || ''; // <--- Ahora vendrá de la lista oficial de 52 provincias
      
      if (!calle && !pob) return "Dirección no especificada";
      
      return `${calle} ${num}`.trim() + `<br>${cp} ${pob} ${prov ? '('+prov+')' : ''}`.trim();
    };

    const issuerAddressHTML = formatAddress(issuer.direccion, issuer);
    const issuerPhone = issuer.telefono || issuer.movil || issuer.phone || '';
    const fiscalAddressHTML = formatAddress(client.direccion_fiscal, client);

    let shippingName = client.nombre_fiscal;
    let shippingAddressHTML = "";
    const targetSedeId = inv.sede_id || inv.site_id;
    const sede = targetSedeId && client.sedes ? client.sedes.find(s => String(s.id) === String(targetSedeId)) : null;

    if (sede) {
      shippingName = sede.nombre || client.nombre_fiscal;
      shippingAddressHTML = formatAddress(sede.direccion, sede);
    } else {
      if (client.direccion_comercial) shippingAddressHTML = formatAddress(client.direccion_comercial);
      if (!shippingAddressHTML || shippingAddressHTML === fiscalAddressHTML) {
         shippingAddressHTML = '<span style="color:#94a3b8; font-style:italic; font-size:10px;">(Misma dirección fiscal)</span>';
      }
    }

    return `<html><head><style>body { font-family: 'Helvetica', 'Arial', sans-serif; padding: 40px; color: #1e293b; line-height: 1.3; font-size: 11px; } .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 15px; margin-bottom: 30px; } .company-info h1 { margin: 0; font-size: 18px; text-transform: uppercase; color: #0f172a; } .company-details { font-size: 10px; color: #64748b; margin-top: 5px; } .logo-box { text-align: right; } .brand { font-size: 28px; font-weight: 900; letter-spacing: -1px; } .brand span { color: #f59e0b; } .invoice-number { font-size: 14px; font-weight: bold; margin-top: 5px; color: #0f172a; } .invoice-date { font-size: 11px; color: #64748b; } .address-container { display: flex; gap: 20px; margin-bottom: 30px; } .addr-col { flex: 1; padding: 15px; border-radius: 6px; } .bill-to { background: #f8fafc; border: 1px solid #e2e8f0; } .ship-to { background: #fff; border: 1px dashed #cbd5e1; } .addr-title { font-size: 9px; font-weight: 900; text-transform: uppercase; color: #94a3b8; margin-bottom: 8px; display: block; } .addr-name { font-size: 12px; font-weight: bold; color: #0f172a; margin-bottom: 2px; } .addr-cif { font-family: monospace; font-size: 10px; color: #64748b; margin-bottom: 6px; display: block; } .addr-text { font-size: 11px; color: #334155; } table { width: 100%; border-collapse: collapse; margin-bottom: 20px; } th { background: #0f172a; color: white; text-align: left; padding: 8px; font-size: 9px; text-transform: uppercase; } td { border-bottom: 1px solid #f1f5f9; padding: 10px 8px; font-size: 11px; } .text-right { text-align: right; } .bold { font-weight: bold; } .totals-wrap { display: flex; justify-content: flex-end; } .totals-table { width: 220px; } .t-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 11px; font-weight: bold; color: #475569; } .t-final { border-top: 2px solid #0f172a; margin-top: 8px; padding-top: 8px; font-size: 16px; color: #0f172a; font-weight: 900; } .footer { position: fixed; bottom: 0; left: 0; right: 0; text-align: center; font-size: 9px; color: #cbd5e1; padding-top: 10px; border-top: 1px solid #f1f5f9; }</style></head><body><div class="header"><div class="company-info"><h1>${issuer.nombre_fiscal || 'EMPRESA'}</h1><div class="company-details">CIF: ${issuer.cif || ''}<br>${issuerAddressHTML}<br>${issuerPhone}</div></div><div class="logo-box"><div class="brand">han<span>doo</span></div><div class="invoice-number">FACTURA ${inv.numero || 'BORRADOR'}</div><div class="invoice-date">${new Date(inv.fecha).toLocaleDateString('es-ES')}</div></div></div><div class="address-container"><div class="addr-col bill-to"><span class="addr-title">FACTURAR A (DATOS FISCALES)</span><div class="addr-name">${client.nombre_fiscal}</div><span class="addr-cif">NIF: ${client.cif}</span><div class="addr-text">${fiscalAddressHTML || '<span style="color:red">Dirección no disponible</span>'}</div></div><div class="addr-col ship-to"><span class="addr-title">DIRECCIÓN DE ENVÍO / SERVICIO</span><div class="addr-name" style="font-size:11px">${shippingName}</div><div class="addr-text" style="margin-top:5px">${shippingAddressHTML}</div></div></div><table><thead><tr><th style="width:50%">Descripción</th><th class="text-right">Cant.</th><th class="text-right">Precio</th><th class="text-right">Total</th></tr></thead><tbody><tr><td class="bold">${inv.item_display_name || 'Servicios Profesionales'}</td><td class="text-right">1</td><td class="text-right">${fmt(inv.base)}</td><td class="text-right bold">${fmt(inv.base)}</td></tr></tbody></table><div class="totals-wrap"><div class="totals-table"><div class="t-row"><span>Base Imponible</span> <span>${fmt(inv.base)}</span></div><div class="t-row"><span>IVA</span> <span>${fmt(inv.total_iva)}</span></div>${inv.total_ret > 0 ? `<div class="t-row" style="color:#ef4444"><span>Retención</span> <span>-${fmt(inv.total_ret)}</span></div>` : ''}<div class="t-row t-final"><span>TOTAL</span><span>${fmt(inv.total)}</span></div></div></div><div class="footer">Registro Mercantil: ${issuer.registro || ''} | Generado por Handoo OS Titanium</div></body></html>`;
  },

  createManualDraft: function(payload) {
    try {
      const draftId = "DFT-MANUAL-" + Date.now();
      payload.id = draftId;
      payload.status = this.STATUS_DRAFT;
      payload.fecha = new Date().toISOString().split('T')[0];
      _DB.save("DB_INVOICES", draftId, payload);
      return Response.success(payload, "Borrador manual creado.");
    } catch (e) { return Response.error(e.message); }
  },

  saveManualInvoice: function(payload) {
    try {
      if(!payload.id) return Response.error("Identificador de documento requerido.");
      _DB.save("DB_INVOICES", payload.id, payload);
      Admin_Controller.updatePGCSaldos();
      return Response.success(payload, "Sincronización manual completada.");
    } catch (e) { return Response.error(e.message); }
  },

  /**
   * DELETE BATCH V104: Soporte para borrado masivo atómico.
   */
  delete: function(payload) {
    try {
      const ids = payload.ids || [payload.id];
      if (!ids || ids.length === 0) return Response.error("Identificadores requeridos.");
      
      const invoices = _DB.get("DB_INVOICES") || [];
      let count = 0;

      for (const id of ids) {
        const inv = invoices.find(i => String(i.id) === String(id));
        if (!inv) continue;

        if (inv.status === this.STATUS_ISSUED) {
           inv.status = this.STATUS_DRAFT;
           inv.reverted_at = new Date().toISOString();
           _DB.save("DB_INVOICES", inv.id, inv);
        } else if (inv.status === this.STATUS_DRAFT) {
           _DB.moveToTrash("DB_INVOICES", id);
        }
        count++;
      }
      return Response.success(null, `${count} documentos procesados.`);
    } catch (e) { return Response.error(e.message); }
  }
};