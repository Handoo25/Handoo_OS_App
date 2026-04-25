/**
 * Module_Production.gs - ERP TITANIUM PRODUCTION ENGINE (BRAIN)
 */
var Module_Production = {
  calculateAllergens: function(formulaComponents) {
    const inherited = new Set();
    const masters = _DB.get("MASTERS") || [];
    const allergensDB = _DB.get("DB_ALLERGENS") || [];

    (formulaComponents || []).forEach(comp => {
       const m = masters.find(x => String(x.id) === String(comp.master_id));
       if (m && m.alergenos) { 
           // Blindaje: por si está guardado como texto o como array
           const algList = Array.isArray(m.alergenos) ? m.alergenos : [m.alergenos];
           algList.forEach(aId => {
               const algObj = allergensDB.find(a => String(a.id) === String(aId) || String(a.nombre).toLowerCase() === String(aId).toLowerCase());
               if (algObj) inherited.add(algObj.nombre.toUpperCase());
               else inherited.add(String(aId).toUpperCase());
           }); 
       }
    });
    return Array.from(inherited);
  },

  getFIFOSimulation: function(formula) {
    const masters = _DB.get("MASTERS") || [];
    const simulation = { components: [], fecha_caducidad_sugerida: null, resumen_lotes: "" };
    let minExpiry = null;
    let resumeArr = [];

    (formula.components || []).forEach(comp => {
       const m = masters.find(x => x.id === comp.master_id);
       const batches = (m && m.batches) ? [...m.batches].sort((a,b) => new Date(a.expiry_date) - new Date(b.expiry_date)) : [];
       const firstBatch = batches[0];
       
       let textoLote = '[Sin Stock]';
       let fechaCad = new Date(Date.now() + 86400000 * 30).toISOString();

       if (firstBatch) {
           fechaCad = firstBatch.expiry_date || fechaCad;
           const idLote = String(firstBatch.id || '').toUpperCase();
           
           // Prioridad 1: Lote Real (que no sea S/L ni vacío)
           if (idLote && idLote !== 'S/L' && !idLote.startsWith('BATCH-')) {
               textoLote = idLote;
           } 
           // Prioridad 2: Factura o Referencia de compra
           else if (firstBatch.invoice_ref || firstBatch.order_id) {
               textoLote = `FAC: ${firstBatch.invoice_ref || firstBatch.order_id}`;
           }
           // Prioridad 3: Fecha de entrada (si es lote automático del sistema)
           else {
               const fechaEntrada = firstBatch.entry_date ? new Date(firstBatch.entry_date).toLocaleDateString('es-ES') : '---';
               textoLote = `INT (Ent: ${fechaEntrada})`;
           }
       } else {
           // 🔥 NUEVO: Si no hay lote, buscamos la fecha de la última compra o modificación
           const fechaRef = m ? (m.last_purchase_date || m.updated_at || m.fecha_ultima_compra) : null;
           if (fechaRef) {
               textoLote = `S/L (Ref: ${new Date(fechaRef).toLocaleDateString('es-ES')})`;
           } else {
               textoLote = 'S/L (Sin fecha)';
           }
       }
       
       const compTrace = {
         nombre: m ? m.nombre : '?',
         lote_usado: textoLote,
         fecha_caducidad: fechaCad,
         is_critical: false
       };

       if (firstBatch && firstBatch.expiry_date) {
          const exp = new Date(firstBatch.expiry_date);
          if (!minExpiry || exp < minExpiry) {
             minExpiry = exp;
             compTrace.is_critical = true;
          }
       }
       simulation.components.push(compTrace);
       const nombreCorto = compTrace.nombre.substring(0, 4).toUpperCase();
       resumeArr.push(`${nombreCorto}: ${compTrace.lote_usado}`);
    });

    const vidaUtilFormula = parseFloat(formula.vida_util || 3);
    const suggestedDate = new Date();
    suggestedDate.setDate(suggestedDate.getDate() + vidaUtilFormula);

    if (minExpiry && minExpiry < suggestedDate) {
       simulation.fecha_caducidad_sugerida = minExpiry.toISOString();
    } else {
       simulation.fecha_caducidad_sugerida = suggestedDate.toISOString();
    }
    
    simulation.resumen_lotes = resumeArr.join(' | ');
    return simulation;
  }
};
