/**
 * Production_Controller.gs - API TITANIUM PRODUCTION
 */
var Production_Controller = {
  _checkAccess: function() { return true; },

  executeProduction: function(p) {
    this._checkAccess();
    try {
      const formulas = _DB.get("DB_FORMULAS") || [];
      const formula = formulas.find(f => String(f.id) === String(p.formula_id));
      if (!formula) throw new Error("Ficha técnica no localizada.");

      (formula.components || []).forEach(comp => {
         const qtyNeeded = parseFloat(comp.cantidad_bruta) * parseFloat(p.cantidad);
         Inventory_Controller.adjust_stock({
           producto_id: comp.master_id, cantidad: qtyNeeded, tipo: 'RESTA', concept: `PRODUCCIÓN: ${formula.nombre}`
         });
      });

      const id = _DB.getNextSequentialId("DB_PRODUCTION_LOGS", "PRD");
      const log = {
        id: id, formula_id: p.formula_id, formula_nombre: formula.nombre, cantidad: parseFloat(p.cantidad),
        unidad_medida: p.unidad_medida || 'Uds', fecha_produccion: new Date().toISOString(),
        fecha_caducidad: p.fecha_caducidad, lote: p.lote, trazabilidad_resumen: p.trazabilidad_resumen,
        usuario: p.usuario || 'Admin', alergenos_calculados: Module_Production.calculateAllergens(formula.components)
      };

      _DB.save("DB_PRODUCTION_LOGS", id, log);
      
      if(formula.master_link) {
         Inventory_Controller.adjust_stock({
            producto_id: formula.master_link, cantidad: parseFloat(p.cantidad), tipo: 'SUMA',
            expiry_date: p.fecha_caducidad, concept: `ENTRADA PRODUCCIÓN: ${p.lote}`
         });
      }

      Admin_Controller.updatePGCSaldos();
      return Response.success(log, "Producción registrada y trazada.");
    } catch(e) { return Response.error(e.message); }
  },

  simulate_fifo: function(p) {
    this._checkAccess();
    try {
      const formulas = _DB.get("DB_FORMULAS") || [];
      const formula = formulas.find(f => String(f.id) === String(p.formula_id));
      if(!formula) throw new Error("Ficha no encontrada.");
      return Response.success(Module_Production.getFIFOSimulation(formula));
    } catch(e) { return Response.error(e.message); }
  },

  getHistory: function() {
    this._checkAccess();
    try {
      const logs = _DB.get("DB_PRODUCTION_LOGS") || [];
      const formulas = _DB.get("DB_FORMULAS") || [];

      // 🔥 AUTO-REPARADOR DE ALÉRGENOS PARA LOTES ANTIGUOS
      logs.forEach(log => {
          if (!log.alergenos_calculados || log.alergenos_calculados.length === 0) {
              const form = formulas.find(f => String(f.id) === String(log.formula_id));
              if (form) {
                  log.alergenos_calculados = Module_Production.calculateAllergens(form.components);
                  _DB.save("DB_PRODUCTION_LOGS", log.id, log); // Lo dejamos arreglado en la base de datos
              }
          }
      });

      return Response.success(logs.sort((a,b) => new Date(b.fecha_produccion) - new Date(a.fecha_produccion)));
    } catch(e) { return Response.error(e.message); }
  },

  cancel_production: function(payload) {
    this._checkAccess();
    try {
      const logs = _DB.get("DB_PRODUCTION_LOGS") || [];
      const log = logs.find(l => String(l.id) === String(payload.id));
      if(!log) throw new Error("Registro no encontrado.");
      if(log.status === 'CANCELLED') throw new Error("Este lote ya estaba anulado.");

      const formulas = _DB.get("DB_FORMULAS") || [];
      const formula = formulas.find(f => String(f.id) === String(log.formula_id));
      
      if (formula) {
         // 1. Devolver ingredientes crudos al almacén (SUMA)
         (formula.components || []).forEach(comp => {
             const qtyNeeded = parseFloat(comp.cantidad_bruta) * parseFloat(log.cantidad);
             Inventory_Controller.adjust_stock({
                 producto_id: comp.master_id,
                 cantidad: qtyNeeded,
                 tipo: 'SUMA',
                 concept: `ANULACIÓN PROD: ${formula.nombre}`
             });
         });

         // 2. Restar el producto final generado de la nevera (RESTA)
         if (formula.master_link) {
             Inventory_Controller.adjust_stock({
                 producto_id: formula.master_link,
                 cantidad: parseFloat(log.cantidad),
                 tipo: 'RESTA',
                 concept: `ANULACIÓN PROD: ${log.lote}`
             });
         }
      }

      // 3. Actualizar el historial para Sanidad (No lo borramos, lo marcamos)
      log.status = 'CANCELLED';
      log.cancel_reason = payload.motivo;
      log.cancel_date = new Date().toISOString();
      log.cancel_user = payload.usuario || 'Admin';

      _DB.save("DB_PRODUCTION_LOGS", payload.id, log);
      return Response.success(log, "Producción anulada y stock restaurado.");
    } catch(e) { return Response.error(e.message); }
  },

  update_log: function(payload) {
    this._checkAccess();
    try {
      const logs = _DB.get("DB_PRODUCTION_LOGS") || [];
      const log = logs.find(l => String(l.id) === String(payload.id));
      if(!log) throw new Error("Registro no encontrado.");

      const nuevaCant = parseFloat(payload.cantidad) || 0;
      const diff = nuevaCant - log.cantidad; // Calculamos la diferencia exacta

      // 🔥 MAGIA DE INVENTARIO: Si cambia la cantidad, retro-ajustamos el almacén
      if (diff !== 0) {
         const formulas = _DB.get("DB_FORMULAS") || [];
         const formula = formulas.find(f => String(f.id) === String(log.formula_id));
         if (formula) {
             // 1. Ajustar ingredientes (Si produjimos más (diff +), restamos más materia prima. Si produjimos menos (diff -), sumamos materia prima devuelta).
             (formula.components || []).forEach(comp => {
                 const qtyDiff = parseFloat(comp.cantidad_bruta) * Math.abs(diff);
                 Inventory_Controller.adjust_stock({
                     producto_id: comp.master_id,
                     cantidad: qtyDiff,
                     tipo: diff > 0 ? 'RESTA' : 'SUMA',
                     concept: `CORRECCIÓN PROD: ${formula.nombre}`
                 });
             });

             // 2. Ajustar producto final
             if (formula.master_link) {
                 Inventory_Controller.adjust_stock({
                     producto_id: formula.master_link,
                     cantidad: Math.abs(diff),
                     tipo: diff > 0 ? 'SUMA' : 'RESTA',
                     concept: `CORRECCIÓN PROD: ${log.lote}`
                 });
             }
         }
      }

      log.lote = payload.lote;
      log.cantidad = nuevaCant;
      if (payload.fecha_caducidad) {
         log.fecha_caducidad = new Date(payload.fecha_caducidad).toISOString();
      }

      _DB.save("DB_PRODUCTION_LOGS", payload.id, log);
      // Admin_Controller.updatePGCSaldos(); // Actualiza saldos contables
      return Response.success(log, "Actualizado y stock cuadrado");
    } catch(e) { return Response.error(e.message); }
  },

  audit_batch: function(payload) {
    this._checkAccess();
    try {
      const logs = _DB.get("DB_PRODUCTION_LOGS") || [];
      const log = logs.find(l => String(l.id) === String(payload.id));
      if(!log) throw new Error("Registro no encontrado.");

      const mermaQty = parseFloat(payload.merma_qty) || 0;
      const arrastreQty = parseFloat(payload.arrastre_qty) || 0;

      // 1. SI HAY MERMA FÍSICA A LA BASURA -> Restamos del inventario final y guardamos registro
      if (mermaQty > 0) {
          // Restamos el producto de la nevera
          const formulas = _DB.get("DB_FORMULAS") || [];
          const formula = formulas.find(f => String(f.id) === String(log.formula_id));
          if (formula && formula.master_link) {
              Inventory_Controller.adjust_stock({
                  producto_id: formula.master_link,
                  cantidad: mermaQty,
                  tipo: 'RESTA',
                  concept: `MERMA (${payload.merma_tipo}): ${log.lote}`
              });
          }
          
          // Guardamos en el historial de Mermas de Chemin AI
          const wasteId = _DB.getNextSequentialId("DB_WASTE_LOGS", "WST");
          _DB.save("DB_WASTE_LOGS", wasteId, {
              id: wasteId,
              producto_id: log.formula_id,
              lote: log.lote,
              cantidad: mermaQty,
              tipo: payload.merma_tipo,
              procedencia: payload.merma_procedencia, // 🔥 FRESCO o ARRASTRE
              fecha: new Date().toISOString(),
              usuario: payload.usuario
          });
      }

      // 2. ACTUALIZAMOS EL LOTE (Para que la AI lea el remanente mañana)
      log.audited = true;
      log.merma_registrada = mermaQty;
      log.remanente_manana = arrastreQty; // ESTE es el dato de oro para la Mise en Place
      log.audit_date = new Date().toISOString();

      _DB.save("DB_PRODUCTION_LOGS", payload.id, log);
      return Response.success(log, "Auditoría de lote procesada correctamente.");
    } catch(e) { return Response.error(e.message); }
  },

  get_daily_prep: function() {
    this._checkAccess();
    try {
      const formulas = _DB.get("DB_FORMULAS") || [];
      const logs = _DB.get("DB_PRODUCTION_LOGS") || [];

      let tasks = [];

      formulas.forEach(f => {
          // Buscamos el último lote de este producto que haya sido auditado (cierre de turno)
          const logsProducto = logs.filter(l => String(l.formula_id) === String(f.id) && l.audited === true);
          logsProducto.sort((a,b) => new Date(b.audit_date) - new Date(a.audit_date));
          const ultimoLog = logsProducto[0];

          // Sacamos el remanente real que el usuario guardó ayer
          const arrastre = ultimoLog ? (parseFloat(ultimoLog.remanente_manana) || 0) : 0;

          // TODO: Aquí conectaremos el algoritmo de Chemin AI. Por ahora ponemos 15 por defecto.
          const previsionBase = 15; 

          tasks.push({
              id: f.id,
              nombre: f.nombre,
              prevision_ai: previsionBase,
              arrastre_ayer: arrastre,
              unidad: 'Uds', // O f.unidad si la tienes en la fórmula
              done: false
          });
      });

      return Response.success(tasks);
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * Guarda ajustes de configuración del módulo.
   */
  save: function(payload) {
    this._checkAccess();
    // Aquí iría la lógica de guardado de ajustes específicos si se requieren
    return Response.success({}, "Ajustes guardados.");
  }
};
