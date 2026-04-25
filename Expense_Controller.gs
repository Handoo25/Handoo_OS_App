/**
 * Expense_Controller.gs - TITANIUM PROCUREMENT & OPERATIONS ENGINE V118.0 (BULK & INTEGRITY OPTIMIZED)
 */
var Expense_Controller = {
  
  list: function() {
    try {
      const expenses = Repository.Expenses.getAll();
      const deliveryNotes = _DB.get("DB_DELIVERY_NOTES") || [];
      const orders = _DB.get("DB_PURCHASE_ORDERS") || [];
      const all = [...expenses, ...deliveryNotes, ...orders];
      return Response.success(all.sort((a,b) => new Date(b.fecha) - new Date(a.fecha)));
    } catch(e) { return Response.success([]); }
  },

  /**
   * CLAIMS SHIELD V125: REGISTRO DE INCIDENCIAS LOGÍSTICAS
   * Crea un "Efecto de Reclamación" (Inbound) en Tesorería vinculado a un proveedor.
   */
  registerIncident: function(payload) {
    try {
      const { docId, amount, reason, vendorId } = payload;
      const vendors = _DB.get("DB_VENDORS") || [];
      const vendor = vendors.find(v => String(v.id) === String(vendorId));
      
      const claimId = "CLM-" + Date.now();
      const effectId = "PROV-" + claimId;
      
      // Inyectamos un efecto INBOUND (Dinero que nos deben) en la tabla de efectos
      // Esto compensará la deuda bruta del proveedor en el Mayor de Tesorería.
      _DB.save("DB_TREASURY_EFFECTS", effectId, {
        id: effectId,
        source_doc: docId,
        direction: 'INBOUND', 
        status: 'PENDIENTE_CONCILIAR',
        importe: parseFloat(amount),
        vencimiento: new Date().toISOString().split('T')[0],
        beneficiario: vendor?.nombre_fiscal || 'PROVEEDOR INCIDENCIA',
        vendor_id: vendorId,
        obs: `[RECLAMACIÓN LOGÍSTICA] Motivo: ${reason}. Doc Origen: ${docId}`,
        created_at: new Date().toISOString(),
        type: 'CLAIM'
      });
      
      // Actualizamos el documento origen para marcar la incidencia
      const table = docId.startsWith('ALB') ? "DB_DELIVERY_NOTES" : "DB_EXPENSES";
      const docs = _DB.get(table);
      const doc = docs.find(d => d.id === docId);
      if (doc) {
        doc.has_incident = true;
        doc.claim_ref = claimId;
        _DB.save(table, doc.id, doc);
      }

      Admin_Controller.updatePGCSaldos();
      return Response.success({ claimId }, `Claims Shield: Incidencia registrada. Saldo a favor inyectado en Tesorería.`);
    } catch(e) { return Response.error("Fallo Claims Shield: " + e.message); }
  },

  /**
   * ESCUDO ANTI-DUPLICADO V117 (MOTOR HEURÍSTICO)
   * Detecta duplicidades por nº de documento, o por combinación de Fecha + Importe para el mismo proveedor.
   */
  checkPotentialDuplicate: function(payload) {
    try {
      const vendorName = String(payload.beneficiario || '').toUpperCase().trim();
      const docNum = String(payload.invoice_num || '').toUpperCase().trim();
      const total = parseFloat(payload.total || 0);
      const fecha = payload.fecha;
      const currentId = payload.id;

      if (!vendorName) return Response.success(null);

      const expenses = Repository.Expenses.getAll();
      const deliveryNotes = _DB.get("DB_DELIVERY_NOTES") || [];
      const allDocs = [...expenses, ...deliveryNotes];

      const match = allDocs.find(d => {
         // Ignorar si es el mismo documento que estamos editando
         if (currentId && String(d.id) === String(currentId)) return false;
         
         const isSameVendor = String(d.beneficiario || '').toUpperCase().trim() === vendorName;
         if (!isSameVendor) return false;

         // Regla 1: Mismo número de documento (Si existe)
         if (docNum && docNum !== '' && String(d.invoice_num || '').toUpperCase().trim() === docNum) return true;

         // Regla 2: Misma fecha AND mismo importe exacto (Alarma de duplicidad administrativa)
         if (d.fecha === fecha && Math.abs(parseFloat(d.total || 0) - total) < 0.01) return true;

         return false;
      });

      return Response.success(match ? { id: match.id, num: match.invoice_num || match.id, total: match.total, fecha: match.fecha, type: match.type } : null);
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * Localiza albaranes pendientes para un proveedor dado (Para Invoices).
   * V116.5: Tolerancia a estados nulos o "RECIBIDO".
   */
  findMatches: function(payload) {
    try {
      const vendorName = String(payload.vendor_name || '').toUpperCase().trim();
      const allNotes = _DB.get("DB_DELIVERY_NOTES") || [];
      
      const matches = allNotes.filter(n => {
        const nameMatch = String(n.beneficiario || '').toUpperCase().trim() === vendorName;
        const statusMatch = !n.status || n.status === 'RECIBIDO';
        return nameMatch && statusMatch;
      });
      
      return Response.success(matches);
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * Localiza pedidos pendientes para un proveedor dado (Para Albaranes).
   */
  findPendingOrders: function(payload) {
    try {
      const vendorName = String(payload.vendor_name || '').toUpperCase().trim();
      const allOrders = _DB.get("DB_PURCHASE_ORDERS") || [];
      
      const matches = allOrders.filter(o => {
        const nameMatch = String(o.beneficiario || '').toUpperCase().trim() === vendorName;
        const statusMatch = !o.status || o.status === 'PENDIENTE';
        return nameMatch && statusMatch;
      });
      
      return Response.success(matches);
    } catch(e) { return Response.error(e.message); }
  },

  uploadTempFile: function(payload) {
    try {
      const drive_id = this._persistToDrive(payload);
      SpreadsheetApp.flush();
      return Response.success({ drive_id: drive_id });
    } catch(e) { return Response.error("Fallo de presubida: " + e.message); }
  },

  /**
   * MOTOR DE AUDITORÍA DE PRECIOS V120
   * PRIORIDAD: 1. Tarifa Pactada (MASTERS) | 2. Memoria Histórica (VENDOR)
   */
  _checkPriceDeviation: function(vendor, item) {
    // 1. INTELIGENCIA PREVENTIVA: Buscar Tarifa Maestra pactada en Catálogo
    try {
      const masters = _DB.get("MASTERS") || [];
      const masterItem = masters.find(m => String(m.id) === String(item.master_id) || m.nombre === String(item.concept).toUpperCase());
      if (masterItem && masterItem.aliases && vendor) {
         const alias = masterItem.aliases.find(a => String(a.vendor_id) === String(vendor.id));
         if (alias && alias.tariff_price && alias.tariff_price > 0) {
            const threshold = parseFloat(Admin_Controller._getSafeSetting("PRICE_DEVIATION_THRESHOLD", 5));
            const deviation = ((item.price - alias.tariff_price) / alias.tariff_price) * 100;
            if (deviation > threshold) {
               return { alert: true, diff: deviation, old: alias.tariff_price, is_tariff: true };
            }
         }
      }
    } catch(e) { console.warn("Error en Auditoría Preventiva: " + e.message); }

    // 2. AUDITORÍA REACTIVA: Memoria Histórica de Compras
    if (!vendor || !vendor.price_memory) return { alert: false };
    const historicalPrice = vendor.price_memory[item.concept.toUpperCase()];
    if (historicalPrice && historicalPrice > 0) {
      const threshold = parseFloat(Admin_Controller._getSafeSetting("PRICE_DEVIATION_THRESHOLD", 5));
      const deviation = ((item.price - historicalPrice) / historicalPrice) * 100;
      if (deviation > threshold) { 
        return { alert: true, diff: deviation, old: historicalPrice, is_tariff: false };
      }
    }
    return { alert: false };
  },

  save: function(payload) {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(30000);
      
      // BLINDAJE DE INTEGRIDAD V131: Validación de Periodo Cerrado en Servidor
      const closingDate = Admin_Controller._getSafeSetting("CLOSING_DATE", "");
      if (closingDate && payload.fecha && payload.fecha <= closingDate) {
         return Response.error(`BLOQUEO DE CIERRE: El periodo contable hasta el ${closingDate} está cerrado. No es posible sincronizar este documento.`);
      }

      if (!payload.type) return Response.error("Clasificación de documento requerida.");
      
      const vendors = _DB.get("DB_VENDORS") || [];
      let vendor = null;

      // 1. RESOLUCIÓN DE PROVEEDOR
      if (payload.vendor_id && payload.vendor_id !== 'new') {
        vendor = vendors.find(v => String(v.id) === String(payload.vendor_id));
      }
      
      if (!vendor && payload.vendor_metadata?.cif && payload.vendor_metadata.cif !== 'PENDIENTE') {
        const cleanCIF = String(payload.vendor_metadata.cif).toUpperCase().trim();
        vendor = vendors.find(v => String(v.cif).toUpperCase().trim() === cleanCIF);
      }

      if (!vendor && payload.beneficiario) {
        const vendorName = String(payload.beneficiario).toUpperCase().trim();
        vendor = vendors.find(v => String(v.nombre_fiscal).toUpperCase().trim() === vendorName);
      }

      // 2. AUTO-CREACIÓN SI NO EXISTE
      if (!vendor && payload.beneficiario) {
        const detectedMethod = (payload.vendor_metadata?.method || payload.metodo_pago || '').toUpperCase();
        const validMethods = ['TRANSFERENCIA', 'SEPA', 'EFECTIVO', 'TARJETA'];
        const finalMethod = validMethods.includes(detectedMethod) ? detectedMethod : 'PENDIENTE_CONCILIAR';

        const newVendor = {
          id: 'new',
          nombre_fiscal: String(payload.beneficiario).toUpperCase().trim(),
          cif: String(payload.vendor_metadata?.cif || "PENDIENTE").toUpperCase(),
          categoria: "MERCANCÍA (AUTO)",
          estado: "Activo",
          comercial: {
            email_facturacion: payload.vendor_metadata?.email || '',
            telefono: payload.vendor_metadata?.phone || ''
          },
          direccion_fiscal: {
            tipo_via: payload.vendor_metadata?.street_type || 'Calle',
            nombre: payload.vendor_metadata?.street_name || '',
            num: payload.vendor_metadata?.street_number || '',
            cp: payload.vendor_metadata?.postal_code || '',
            pob: payload.vendor_metadata?.city || '',
            prov: payload.vendor_metadata?.province || '',
            pais: 'ESPAÑA'
          },
          facturacion: {
            forma_pago: finalMethod,
            iban: payload.vendor_metadata?.iban || '',
            vencimiento: parseInt(payload.vencimiento_dias || 30)
          }
        };

        const vRes = Vendor_Controller.save(newVendor);
        if(vRes.ok) { 
          vendor = vRes.data; 
          SpreadsheetApp.flush(); 
        } else if (vRes.msg.includes("DUPLICADO")) {
          const existing = _DB.get("DB_VENDORS").find(v => v.cif === newVendor.cif);
          if (existing) vendor = existing;
        }
      }

      if (vendor) {
        payload.vendor_id = vendor.id;
        payload.beneficiario = vendor.nombre_fiscal;
      }

      // 3. PERSISTENCIA EN DRIVE
      if (!payload.drive_id && payload.base64 && payload.fileName) {
          payload.drive_id = this._persistToDrive(payload);
      }

      // 4. GESTIÓN DE PRODUCTOS, TRAZABILIDAD Y AUDITORÍA DE PRECIOS
      const catalog = _DB.get("MASTERS") || [];
      let docNeedsConciliation = false;
      let priceAlerts = [];
      let logisticsAlert = false;

      if (payload.items && payload.items.length > 0) {
        payload.items = payload.items.map(it => {
          let masterItem = catalog.find(m => m.nombre === String(it.concept).toUpperCase() || m.id === it.master_id);
          
          const dev = this._checkPriceDeviation(vendor, it);
          if (dev.alert) {
             priceAlerts.push({ concept: it.concept, deviation: dev.diff, old: dev.old, new: it.price, is_tariff: dev.is_tariff });
             it.price_alert = true;
          }

          if (!masterItem && it.concept) {
             docNeedsConciliation = true;
             it.needs_conciliation = true;
          } else if (masterItem) {
             it.master_id = masterItem.id;
             it.needs_conciliation = false;
             
             const alias = masterItem.aliases?.find(a => String(a.vendor_id) === String(vendor?.id) && String(a.vendor_ref) === String(it.vendor_ref).toUpperCase());
             if (alias) {
                if ((it.vendor_format && it.vendor_format !== alias.vendor_format) || (it.conversion_factor && parseFloat(it.conversion_factor) !== parseFloat(alias.conversion_factor))) {
                  logisticsAlert = true;
                  it.logistics_conflict = true;
                }
                it.conversion_factor = it.conversion_factor || alias.conversion_factor || 1;
                it.vendor_format = it.vendor_format || alias.vendor_format || 'CAJA';
             }

             if (vendor) Module_Inventory.learnAlias(masterItem.id, vendor.id, it.vendor_ref || 'S/R', it.price, it.conversion_factor || 1, it.vendor_format || 'UNIDAD');
          }
          return it;
        });
      }

      payload.needs_conciliation = docNeedsConciliation;
      payload.price_alerts = priceAlerts;
      payload.logistics_alert = logisticsAlert;

      if (priceAlerts.length > 0 && vendor) {
        vendor.has_price_alert = true;
        _DB.save("DB_VENDORS", vendor.id, vendor);
      }

      // 5. WORKFLOW DE APROBACIÓN
      const approvalThreshold = parseFloat(Admin_Controller._getSafeSetting("EXPENSE_APPROVAL_THRESHOLD", 1000));
      if (payload.total > approvalThreshold && payload.status !== 'APROBADO_FINANZAS' && payload.type !== 'ORDER') {
         payload.status = 'PENDIENTE_APROBACION';
         payload.requires_approval = true;
      }

      // 6. GESTIÓN DE ACTIVOS FIJOS (CAPEX)
      if (payload.is_asset) {
         const rules = _DB.get("DB_AMORTIZATION_RULES") || [];
         const selectedRule = rules.find(r => String(r.id) === String(payload.asset_nature));
         
         const assetPayload = {
            id: 'new',
            origin_doc: payload.id || 'NEW',
            nombre: (payload.beneficiario || "PROVEEDOR") + " - " + (payload.items?.[0]?.concept || "Inversión"),
            coste_adquisicion: payload.total,
            fecha_compra: payload.fecha,
            estado: 'OPERATIVO',
            vida_util_meses: payload.amort_months || (selectedRule ? (selectedRule.years * 12) : 36),
            rule_id: payload.asset_nature || '',
            amortization_mode: 'STANDARD',
            valor_residual: selectedRule ? (payload.total * (selectedRule.residual_percent / 100)) : 0
         };

         Patrimony_Controller.saveFixedAsset(assetPayload);
      }

      // 7. CONCILIACIÓN DE CICLO: MARCAR ALBARANES COMO FACTURADOS
      if (payload.type === 'INVOICE' && payload.linked_note_ids && payload.linked_note_ids.length > 0) {
          const allNotes = _DB.get("DB_DELIVERY_NOTES") || [];
          payload.linked_note_ids.forEach(noteId => {
             const note = allNotes.find(n => n.id === noteId);
             if (note) {
                note.status = 'FACTURADO';
                note.invoice_ref = payload.id;
                _DB.save("DB_DELIVERY_NOTES", note.id, note);
             }
          });
      }

      // 8. VINCULACIÓN DE PEDIDOS (PARA ALBARANES)
      if (payload.type === 'DELIVERY_NOTE' && payload.linked_order_ids && payload.linked_order_ids.length > 0) {
          const allOrders = _DB.get("DB_PURCHASE_ORDERS") || [];
          payload.linked_order_ids.forEach(orderId => {
             const order = allOrders.find(o => o.id === orderId);
             if (order) {
                order.status = 'RECIBIDO';
                order.delivery_note_ref = payload.id;
                _DB.save("DB_PURCHASE_ORDERS", order.id, order);
             }
          });
      }

      // CONTROL DE DUPLICIDAD (Integridad Crítica Spreadsheet)
      if (payload.invoice_num && vendor) {
        const expenses = Repository.Expenses.getAll();
        const deliveryNotes = _DB.get("DB_DELIVERY_NOTES") || [];
        const allDocs = [...expenses, ...deliveryNotes];
        const isDuplicate = allDocs.some(d => 
           String(d.vendor_id) === String(vendor.id) && 
           String(d.invoice_num).trim().toUpperCase() === String(payload.invoice_num).trim().toUpperCase() &&
           String(d.id) !== String(payload.id)
        );
        // Si el usuario forzó la sincronización (confirmed_duplicate), saltamos el error de bloqueo
        if (isDuplicate && !payload.confirmed_duplicate) return Response.error(`INTEGRIDAD: El documento ${payload.invoice_num} ya existe para ${vendor.nombre_fiscal}.`);
      }

      const tableMap = { 'ORDER': 'DB_PURCHASE_ORDERS', 'DELIVERY_NOTE': 'DB_DELIVERY_NOTES', 'INVOICE': 'DB_EXPENSES', 'DIRECT_EXPENSE': 'DB_EXPENSES' };
      const prefixMap = { 'ORDER': 'ORD', 'DELIVERY_NOTE': 'ALB', 'INVOICE': 'EXP', 'DIRECT_EXPENSE': 'GST' };
      
      if (!payload.id || payload.id === 'new') {
        payload.id = _DB.getNextSequentialId(tableMap[payload.type], prefixMap[payload.type]);
        payload.created_at = new Date().toISOString();
        
        // ASIGNACIÓN DE ESTADOS POR DEFECTO V116.5
        if (payload.type === 'DELIVERY_NOTE') payload.status = 'RECIBIDO';
        if (payload.type === 'ORDER') payload.status = 'PENDIENTE';
        if (payload.type === 'INVOICE' && !payload.status) {
          payload.status = payload.needs_conciliation ? 'CUARENTENA' : 'PENDIENTE';
        }
      }

      delete payload.base64;
      delete payload.fileName;
      delete payload.mimeType;
      delete payload.confirmed_duplicate; // Limpiar flag técnico

      // 🚀 INTEGRACIÓN DE REPOSITORIO (DAL)
      if (tableMap[payload.type] === 'DB_EXPENSES') {
         Repository.Expenses.save(payload);
      } else {
         _DB.save(tableMap[payload.type], payload.id, payload);
      }

      // 9. EFECTO EN TESORERÍA
      if (['ORDER', 'DELIVERY_NOTE', 'INVOICE'].includes(payload.type) && payload.status !== 'PENDIENTE_APROBACION') {
        const effectId = "PROV-" + payload.id;
        _DB.save("DB_TREASURY_EFFECTS", effectId, {
          id: effectId, source_doc: payload.id, direction: 'OUTBOUND', status: 'PENDIENTE',
          importe: parseFloat(payload.total || 0), vencimiento: payload.fecha_vencimiento || payload.fecha,
          beneficiario: payload.beneficiario, vendor_id: payload.vendor_id, 
          created_at: new Date().toISOString(),
          cost_center: payload.cost_center || 'GENERAL'
        });
      }

      Admin_Controller.updatePGCSaldos();
      return Response.success(payload, `Kernel Sincronizado: ${payload.id}`);
    } catch(e) { return Response.error("Core Error: " + e.message); }
    finally { lock.releaseLock(); }
  },

  /**
   * DELETE BATCH V118: Eliminación masiva atómica por array de IDs.
   */
  delete: function(payload) {
    try {
      const ids = payload.ids || [payload.id];
      if (!ids || ids.length === 0) return Response.error("Identificadores requeridos.");
      
      let count = 0;
      ids.forEach(id => {
         const sid = String(id);
         let sheetName = "";
         if (sid.startsWith("EXP-") || sid.startsWith("GST-")) sheetName = "DB_EXPENSES";
         else if (sid.startsWith("ALB-")) sheetName = "DB_DELIVERY_NOTES";
         else if (sid.startsWith("ORD-")) sheetName = "DB_PURCHASE_ORDERS";
         
         const ok = _DB.moveToTrash(sheetName, sid);
         _DB.moveToTrash("DB_TREASURY_EFFECTS", "PROV-" + sid);
         if(ok) count++;
      });
      
      Admin_Controller.updatePGCSaldos();
      return Response.success(null, `${count} documentos movidos a papelera.`);
    } catch(e) { return Response.error(e.message); }
  },

  _persistToDrive: function(payload) {
    try {
      const rootName = "HANDOO_ARCHIVOS";
      const year = new Date().getFullYear().toString();
      const vendorName = (payload.beneficiario || "PROVEEDOR_DESCONOCIDO").replace(/[/\\?%*:|"<>]/g, '-');
      
      let root = DriveApp.getFoldersByName(rootName).hasNext() ? DriveApp.getFoldersByName(rootName).next() : DriveApp.createFolder(rootName);
      let yearFolder = root.getFoldersByName(year).hasNext() ? root.getFoldersByName(year).next() : root.createFolder(year);
      let vendorFolder = yearFolder.getFoldersByName(vendorName).hasNext() ? yearFolder.getFoldersByName(vendorName).next() : yearFolder.createFolder(vendorName);
      
      const b64Data = payload.base64.split(',')[1];
      const fileName = payload.fileName || `DOC_${Date.now()}.pdf`;
      const mimeType = payload.mimeType || "application/pdf";
      const blob = Utilities.newBlob(Utilities.base64Decode(b64Data), mimeType, fileName);
      
      const file = vendorFolder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      return file.getId();
    } catch(e) {
      console.error("Persistencia Drive Error: " + e.message);
      return null;
    }
  },

  pushToInventory: function(payload) {
    try {
      const success = Module_Expenses.pushToInventory(payload.expenseId);
      if (success) {
        return Response.success(null, "Enviado a inventario correctamente con conversión aplicada.");
      }
      return Response.error("Fallo al inyectar en inventario.");
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * Guarda un archivo en el repositorio oficial de Drive.
   */
  saveDocumentToDrive: function(base64, fileName, expId) {
    try {
      let beneficiario = "PROVEEDOR_DESCONOCIDO";
      if (expId && expId !== 'new') {
        const exp = Repository.getById(expId);
        if (exp) beneficiario = exp.beneficiario;
      }
      const drive_id = this._persistToDrive({ base64, fileName, id: expId, beneficiario });
      return Response.success(drive_id, "Documento guardado correctamente.");
    } catch(e) {
      return Response.error("Error al guardar documento: " + e.message);
    }
  },

  /**
   * Sincroniza un gasto pagado con el flujo de caja de Tesorería.
   */
  syncWithTreasury: function(expense) {
    try {
      const success = Module_Expenses.syncWithTreasury(expense);
      if (success) {
        return Response.success(true, "Sincronización con Tesorería completada.");
      }
      return Response.error("Sincronización omitida o módulo no disponible.");
    } catch(e) {
      return Response.error("Error en syncWithTreasury: " + e.message);
    }
  },

  sendEmailWithAttachment: function(payload) {
    try {
      const { id, email } = payload;
      const expenses = Repository.Expenses.getAll();
      const deliveryNotes = _DB.get("DB_DELIVERY_NOTES") || [];
      const orders = _DB.get("DB_PURCHASE_ORDERS") || [];
      const all = [...expenses, ...deliveryNotes, ...orders];
      
      const doc = all.find(d => String(d.id) === String(id));
      if (!doc || !doc.drive_id) return Response.error("Documento no encontrado o sin archivo adjunto.");

      const file = DriveApp.getFileById(doc.drive_id);
      const blob = file.getAs(MimeType.PDF);
      
      const subject = `Factura/Documento de ${doc.beneficiario} - ${doc.invoice_num || doc.id}`;
      const body = `Hola,\n\nAdjuntamos el documento ${doc.invoice_num || doc.id} de ${doc.beneficiario} por un importe de ${doc.total}€.\n\nSaludos,\nEquipo Handoo`;

      MailApp.sendEmail({
        to: email,
        subject: subject,
        body: body,
        attachments: [blob]
      });

      return Response.success(null, "Email enviado correctamente.");
    } catch(e) { return Response.error("Error al enviar email: " + e.message); }
  },

  /**
   * GUARDA BORRADORES DE PEDIDOS DESDE CHEMIN AI
   */
  saveDraftOrder: function(payload) {
    try {
      payload.type = 'ORDER';
      payload.status = payload.estado || 'PENDIENTE'; 
      
      // Aseguramos que tenga un beneficiario legible
      if (!payload.beneficiario && payload.vendor_id) {
        const vendor = (_DB.get("DB_VENDORS") || []).find(v => String(v.id) === String(payload.vendor_id));
        if (vendor) payload.beneficiario = vendor.nombre_fiscal;
      }

      // Calculamos el total bruto del pedido para el flujo de caja
      if (!payload.total && payload.items) {
        payload.total = payload.items.reduce((acc, it) => acc + (parseFloat(it.final_qty || 0) * parseFloat(it.unit_cost || 0)), 0);
      }

      return this.save(payload);
    } catch(e) {
      return Response.error("Error al guardar pedido de Chemin AI: " + e.message);
    }
  }
};
