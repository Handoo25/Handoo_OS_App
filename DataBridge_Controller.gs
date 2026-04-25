/**
 * DataBridge_Controller.gs - TITANIUM UNIVERSAL ADAPTER V2.0
 */
var DataBridge_Controller = {

  /**
   * RECIBIDOR DE TICKETS ÁGORA (WEBHOOK TIEMPO REAL)
   */
  handleAgoraWebhook: function(data) {
    try {
      const clients = _DB.get("tenants") || [];
      const cif = data.CustomerCIF || "GENERIC_TPV";
      
      // Protección de Identidad: Búsqueda por CIF
      let client = clients.find(c => String(c.cif).toUpperCase() === cif.toUpperCase());
      
      if (!client) {
        const newCliRes = Platform_Controller.save({
          id: 'new',
          nombre_fiscal: data.CustomerName || "CLIENTE TPV ÁGORA",
          cif: cif,
          estado: 'Activo',
          facturacion: { forma_pago: 'EFECTIVO', vencimiento: 0 }
        });
        client = newCliRes.data;
      }

      const sale = {
        id: 'AGORA-' + data.OrderNumber,
        client_id: client.id,
        client_name: client.nombre_fiscal,
        base: parseFloat(data.TotalBase || 0),
        total_iva: parseFloat(data.TotalTax || 0),
        total: parseFloat(data.TotalAmount || 0),
        status: 'ISSUED',
        fecha: new Date().toISOString().split('T')[0],
        item_display_name: "VENTA TPV: " + (data.Items?.[0]?.Name || "CONSUMO"),
        created_by: 'AGORA_WEBHOOK'
      };

      _DB.save("DB_INVOICES", sale.id, sale);
      
      // Liquidación inmediata en PGC (Caja)
      _DB.save("DB_TREASURY_EFFECTS", "EFE-" + sale.id, {
        id: "EFE-" + sale.id, invoice_id: sale.id, client_id: client.id,
        importe: sale.total, status: 'COBRADO', metodo: 'EFECTIVO',
        canal_pago: 'CAJA ÁGORA', fecha_cobro_real: new Date().toISOString()
      });

      Admin_Controller.updatePGCSaldos();
      return Response.success(null, "Ticket Ágora procesado.");
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * PROCESADOR DE CSV DE ODOO (CUARENTENA INTELIGENTE)
   */
  processOdooCSV: function(payload) {
    try {
      const rows = payload.rows; 
      const mapping = _DB.get("DB_MIGRATION_MAPPING") || [];
      const stats = { imported: 0, quarantined: 0 };
      
      rows.forEach(row => {
        const extAcc = row.cuenta_odoo;
        const mapped = mapping.find(m => m.external_id === extAcc);
        
        if (!mapped) {
          // Si no hay mapeo previo, registramos en cuarentena para decisión manual
          const qId = 'QUA-' + Utilities.getUuid();
          _DB.save("DB_MIGRATION_QUARANTINE", qId, {
            id: qId,
            external_id: extAcc,
            external_name: row.descripcion_odoo || 'Cuenta Odoo sin nombre',
            sample_data: row,
            timestamp: new Date().toISOString()
          });
          stats.quarantined++;
        } else {
          // Ingesta automática protegida
          this._ingestRow(row, mapped.handoo_id);
          stats.imported++;
        }
      });

      return Response.success(stats, "Migración procesada. Revise la sección de Cuarentena.");
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * IMPORTADOR DE TARIFAS MAESTRAS DE PROVEEDORES V1.0
   */
  importVendorTariffCSV: function(payload) {
    try {
      const { vendor_id, rows } = payload;
      let count = 0;
      
      rows.forEach(row => {
        // Formato esperado: [MasterID, Reference, Price, Format, Factor]
        const masterId = row[0];
        const ref = row[1];
        const price = parseFloat(String(row[2]).replace(',', '.'));
        const format = row[3] || 'CAJA';
        const factor = parseFloat(row[4] || 1);

        if (masterId && !isNaN(price)) {
           const ok = Module_Inventory.learnAlias(masterId, vendor_id, ref, price, factor, format, true);
           if (ok) count++;
        }
      });

      return Response.success(null, `${count} registros de tarifa pactada sincronizados.`);
    } catch(e) { return Response.error("Fallo Importación Tarifa: " + e.message); }
  },

  _ingestRow: function(row, handooAcc) {
    // Protección de Identidad: No duplicar clientes/proveedores por CIF
    const isVenta = String(row.tipo).toUpperCase().includes('VENTA');
    const table = isVenta ? "tenants" : "DB_VENDORS";
    const entities = _DB.get(table);
    
    let entity = entities.find(e => String(e.cif).toUpperCase() === String(row.cif).toUpperCase());
    
    if(!entity) {
       // Crear entidad mínima si no existe
       const newId = _DB.getNextSequentialId(table, isVenta ? "CLI" : "PRV");
       entity = { 
         id: newId, 
         nombre_fiscal: row.nombre_entidad.toUpperCase(), 
         cif: row.cif.toUpperCase(),
         estado: 'Activo',
         cuenta_contable: handooAcc 
       };
       _DB.save(table, newId, entity);
    }

    // Guardar Documento
    const docId = (isVenta ? "OD-V-" : "OD-C-") + row.numero;
    const docData = {
      id: docId,
      beneficiario: entity.nombre_fiscal,
      vendor_id: entity.id,
      client_id: entity.id,
      invoice_num: row.numero,
      fecha: row.fecha,
      total: parseFloat(row.total),
      status: 'ISSUED',
      obs: 'Migrado desde Odoo'
    };
    _DB.save(isVenta ? "DB_INVOICES" : "DB_EXPENSES", docId, docData);
  },

  resolveMapping: function(payload) {
    try {
      const { external_id, handoo_id } = payload;
      
      // 1. Memorizar el vínculo (Aprendizaje Atómico)
      _DB.save("DB_MIGRATION_MAPPING", external_id, {
        id: external_id,
        external_id: external_id,
        handoo_id: handoo_id,
        updated_at: new Date().toISOString()
      });

      // 2. Procesar todos los pendientes en cuarentena con esta cuenta
      const allQua = _DB.get("DB_MIGRATION_QUARANTINE");
      allQua.filter(q => q.external_id === external_id).forEach(q => {
        this._ingestRow(q.sample_data, handoo_id);
        _DB.delete("DB_MIGRATION_QUARANTINE", q.id);
      });

      Admin_Controller.updatePGCSaldos();
      return Response.success(null, "Mapeo consolidado y datos inyectados.");
    } catch(e) { return Response.error(e.message); }
  },

  getQuarantine: function() {
    return Response.success(_DB.get("DB_MIGRATION_QUARANTINE"));
  },

  importAgoraProducts: function(payload) {
    try {
      const products = payload.products; // Array de { name, price, reference }
      let count = 0;
      products.forEach(p => {
        const existing = _DB.get("MASTERS").find(m => m.nombre === p.name.toUpperCase());
        if(!existing) {
           Inventory_Controller.saveMaster({
             nombre: p.name.toUpperCase(),
             pvp: parseFloat(p.price || 0),
             type: 'PRODUCT',
             pgc_root: '700'
           });
           count++;
        }
      });
      return Response.success(null, `${count} productos sincronizados desde Ágora.`);
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * EXPORTACIÓN DE PACK PARA GESTORÍA V3.2 (FILTRADO POR FECHA ROBUSTO & AUTO-CIF)
   */
  exportGestoriaPack: function(payload) {
    try {
      const { start, end, type, includePDFs } = payload;
      const sourceTable = type === 'COMPRA' ? "DB_EXPENSES" : "DB_INVOICES";
      const allDocs = _DB.get(sourceTable) || [];
      const entities = type === 'COMPRA' ? _DB.get("DB_VENDORS") : _DB.get("tenants");
      
      const startDate = new Date(start);
      const endDate = new Date(end);
      endDate.setHours(23, 59, 59, 999);

      // Filtrado robusto basado en objetos Date
      const filtered = allDocs.filter(d => {
        let docDateStr;
        if (payload.date_type === 'FECHA_SUBIDA') {
          docDateStr = d.created_at || d._DB?._createdAt;
        } else {
          docDateStr = d.fecha || d.fecha_emision;
        }
        
        if (!docDateStr) return false;
        const docDate = new Date(docDateStr);
        return !isNaN(docDate.getTime()) && docDate >= startDate && docDate <= endDate;
      });

      const root = DriveApp.getFoldersByName("HANDOO_EXPORTS").hasNext() ? 
                   DriveApp.getFoldersByName("HANDOO_EXPORTS").next() : 
                   DriveApp.createFolder("HANDOO_EXPORTS");
      
      const typeFolderName = type === 'COMPRA' ? "COMPRAS" : "VENTAS";
      const typeFolder = root.getFoldersByName(typeFolderName).hasNext() ? 
                         root.getFoldersByName(typeFolderName).next() : 
                         root.createFolder(typeFolderName);

      const packName = `GESTORIA_${type}_${start}_AL_${end}_${Date.now()}`;
      const folder = typeFolder.createFolder(packName);
      
      let csv = "FECHA;DOCUMENTO;TITULAR;CIF;BASE;IVA;TOTAL;LINK_BÓVEDA\n";
      
      let pdfFolder = null;
      if (includePDFs) {
        pdfFolder = folder.createFolder(`PDFS_ORIGINALES_${type}`);
      }

      filtered.forEach(d => {
        let driveLink = "LISTADO_SIN_PDF";
        let docId = type === 'COMPRA' ? (d.invoice_num || d.id) : (d.numero || d.id);
        let titular = type === 'COMPRA' ? (d.beneficiario || 'S/N') : (d.client_name || 'S/N');
        
        // Resolución de CIF: Búsqueda dinámica si falta en el documento
        let cif = d.cif || '';
        if (!cif || cif === 'PENDIENTE') {
          const entity = entities.find(e => String(e.id) === String(type === 'COMPRA' ? d.vendor_id : d.client_id));
          if (entity) cif = entity.cif;
          else cif = 'S/N';
        }
        
        if(includePDFs && d.drive_id) {
          try {
            const file = DriveApp.getFileById(d.drive_id);
            const copy = file.makeCopy(`${type}_${docId}`, pdfFolder);
            driveLink = copy.getUrl();
          } catch(err) {
            driveLink = "FALLO_ACCESO_DRIVE";
          }
        } else if (includePDFs && !d.drive_id) {
          driveLink = "SIN_ARCHIVO_DIGITAL";
        }

        const totalVal = parseFloat(d.total || 0);
        const baseVal = parseFloat(d.base || (totalVal/1.21));
        const ivaVal = parseFloat(d.total_iva || (totalVal - baseVal));
        
        csv += `${d.fecha};${docId};${titular};${cif};${baseVal.toFixed(2)};${ivaVal.toFixed(2)};${totalVal.toFixed(2)};${driveLink}\n`;
      });

      folder.createFile(`LIBRO_${type}.csv`, csv, MimeType.CSV);

      return Response.success({ url: folder.getUrl() }, `Pack de ${type} generado con éxito (${filtered.length} docs).`);
    } catch(e) { return Response.error("Fallo de exportación Kernel: " + e.message); }
  },

  /**
   * MOTOR DE CARGA MASIVA V1.0
   */
  processMassiveLoad: function(payload) {
    try {
      this.upsertMasters(payload.products);
      this.importFormulas(payload.preps, payload.sales);
      return Response.success(null, "Carga masiva completada con éxito.");
    } catch(e) { return Response.error("Fallo Carga Masiva: " + e.message); }
  },

  upsertMasters: function(products) {
    const masters = _DB.get("MASTERS");
    products.forEach(p => {
      const existing = masters.find(m => m.nombre === p.nombre.toUpperCase());
      const masterData = {
        nombre: p.nombre.toUpperCase(),
        nature: p.nature || 'RAW',
        max_volatility_perc: p.max_volatility_perc || 0,
        avg_daily_usage: p.avg_daily_usage || 0,
        safety_stock: p.safety_stock || 0,
        type: 'PRODUCT',
        pgc_root: '700'
      };
      
      if (existing) {
        Inventory_Controller.saveMaster({...existing, ...masterData});
      } else {
        Inventory_Controller.saveMaster(masterData);
      }
    });
  },

  importFormulas: function(preps, sales) {
    const masters = _DB.get("MASTERS");
    const allFormulas = [...preps, ...sales];
    
    allFormulas.forEach(f => {
      // Validación: master_id debe existir
      const exists = masters.find(m => m.id === f.master_id);
      if (!exists) throw new Error(`Master ID ${f.master_id} no encontrado para la fórmula ${f.nombre}`);
      
      // Uso obligatorio de Inventory_Controller.saveFormula
      Inventory_Controller.saveFormula(f);
    });
  }
};