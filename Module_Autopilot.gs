/**
 * Module_Autopilot.gs - TITANIUM AUTONOMOUS ENGINE V200.0
 * Gestiona la toma de decisiones desatendida del ERP.
 */

var Module_Autopilot = {

  /**
   * Ejecuta una revisión masiva de documentos pendientes buscando coincidencias exactas.
   * Si la confianza es > Umbral y el precio es estable -> Auto-Aprobación.
   */
  runAutonomousReconciliation: function() {
    const settings = Admin_Controller.getSettings().data;
    if (!settings.autopilot_active) return Response.error("Autopilot desactivado en Kernel.");

    const expenses = _DB.get("DB_EXPENSES") || [];
    const notes = _DB.get("DB_DELIVERY_NOTES") || [];
    const vendors = _DB.get("DB_VENDORS") || [];
    const catalog = _DB.get("MASTERS") || [];
    
    let processedCount = 0;
    const confidenceMin = parseFloat(settings.autopilot_confidence_min || 95);
    const deviationMax = parseFloat(settings.autopilot_max_deviation || 2);

    // 1. Escaneo de Gastos e Invoices Pendientes
    expenses.filter(e => e.status === 'PENDIENTE' || e.status === 'PENDIENTE_APROBACION').forEach(doc => {
       const vendor = vendors.find(v => v.id === doc.vendor_id);
       if (!vendor) return;

       let decisionPoints = 0;
       let totalPoints = doc.items?.length || 0;
       let priceMatch = true;

       doc.items?.forEach(it => {
          const master = catalog.find(m => m.id === it.master_id);
          const histPrice = vendor.price_memory?.[String(it.concept).toUpperCase()];
          
          if (master && histPrice) {
             const dev = Math.abs(((it.price - histPrice) / histPrice) * 100);
             if (dev <= deviationMax) {
                decisionPoints++;
             } else {
                priceMatch = false;
             }
          }
       });

       // Criterio de Aceptación Autónoma: 100% de items conocidos y precios estables
       if (totalPoints > 0 && decisionPoints === totalPoints && priceMatch) {
          doc.status = 'APROBADO_FINANZAS';
          doc.autopilot_processed = true;
          doc.obs = "[AUTOPILOT] Cuadre perfecto detectado. Auto-aprobado.";
          _DB.save("DB_EXPENSES", doc.id, doc);
          
          // Activar efecto en tesorería inmediatamente
          const effectId = "PROV-" + doc.id;
          const effect = _DB.get("DB_TREASURY_EFFECTS").find(f => f.id === effectId);
          if (effect) {
             effect.status = 'PENDIENTE';
             _DB.save("DB_TREASURY_EFFECTS", effect.id, effect);
          }
          processedCount++;
       }
    });

    Admin_Controller.updatePGCSaldos();
    return Response.success(null, `Robot Autopilot: ${processedCount} documentos procesados con éxito sin intervención humana.`);
  },

  process_burst_batch: function(payload) {
    try {
      const images = payload.images; // Array of base64
      if (!images || images.length === 0) return Response.error("No hay imágenes para procesar.");
      
      const results = [];
      const FOLDER_ID = "1Kbli27-N78AW0kyjW5I6eL_XArzv11JY"; // Usando la misma carpeta de alérgenos por ahora
      const folder = DriveApp.getFolderById(FOLDER_ID);
      
      images.forEach((base64, index) => {
        const fileName = "SCAN_" + Date.now() + "_" + index + ".jpg";
        const blob = Utilities.newBlob(Utilities.base64Decode(base64.split(',')[1]), "image/jpeg", fileName);
        const file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        
        const inboxItem = {
          id: "INB-" + Date.now() + "-" + index,
          payload: {
            drive_id: file.getId(),
            url: "https://drive.google.com/uc?export=view&id=" + file.getId(),
            type: "EXPENSE_SCAN"
          },
          timestamp: new Date().toISOString()
        };
        
        Repository.Inbox.save(inboxItem);
        results.push(inboxItem.id);
      });
      
      return Response.success(results, "Imágenes procesadas y enviadas a Inbox.");
    } catch(e) {
      return Response.error("Error en process_burst_batch: " + e.message);
    }
  }
};