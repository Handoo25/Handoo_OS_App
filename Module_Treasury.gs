/**
 * Module_Treasury.gs - NÚCLEO DE INGENIERÍA FINANCIERA TITANIUM V500.0
 * Gestión soberana de activos, pasivos, remesas y protocolos de recobro.
 */
var Module_Treasury = {

  /**
   * PROCESADOR DE LIQUIDACIÓN Y DEVOLUCIONES ATÓMICO
   */
  processLiquidacion: function(payload) {
    try {
      const { effect_ids, action, canal_pago, importe_real, gastos, fecha_real } = payload;
      const allEffects = _DB.get("DB_TREASURY_EFFECTS") || [];
      const today = fecha_real || new Date().toISOString().split('T')[0];

      effect_ids.forEach(id => {
        const e = allEffects.find(x => String(x.id) === String(id));
        if (!e) return;

        if (action === 'COBRAR' || action === 'PAGAR') {
           e.status = 'COBRADO';
           e.canal_pago = canal_pago || 'BANCO';
           e.fecha_cobro_real = today;
           const nominal = parseFloat(e.importe);
           const cobrado = parseFloat(importe_real || e.importe);
           
           e.importe_cobrado = cobrado;
           _DB.save("DB_TREASURY_EFFECTS", e.id, e);
           
           if (cobrado < nominal) {
             const resto = nominal - cobrado;
             const restoId = _DB.getNextSequentialId("DB_TREASURY_EFFECTS", "RST");
             _DB.save("DB_TREASURY_EFFECTS", restoId, {
               ...e, id: restoId, importe: resto, status: 'PENDIENTE', 
               fecha_cobro_real: null, canal_pago: null, obs: `Resto pendiente del efecto ${e.id}`
             });
           }
        } 
        else if (action === 'DEVOLVER') {
           e.status = 'DEVUELTO';
           e.fecha_devolucion = today;
           _DB.save("DB_TREASURY_EFFECTS", e.id, e);

           const newId = "D-" + (e.invoice_id || e.id);
           const gastosDev = parseFloat(gastos || 0);
           const nuevoNominal = parseFloat(e.importe) + gastosDev;
           
           _DB.save("DB_TREASURY_EFFECTS", newId, {
             ...e, 
             id: newId, 
             status: 'PENDIENTE', 
             importe: nuevoNominal, 
             vencimiento: today,
             is_unpaid: true,
             parent_id: e.id,
             obs: `IMPAGADO RE-GENERADO. Orig: ${e.importe}€ + Gastos Dev (626): ${gastosDev}€.`,
             created_at: new Date().toISOString()
           });

           if(gastosDev > 0) {
             this._logAccountingMovement({
               cuenta: '626000000',
               concepto: `Gtos. Devolución Efecto ${e.id}`,
               cargo: gastosDev,
               abono: 0,
               ref_id: newId
             });
           }
           this.lockClientForDefault(e.client_id, e.id);
        }
      });

      Admin_Controller.updatePGCSaldos();
      return Response.success(null, "Operación de tesorería consolidada.");
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * MOTOR DE PRÉSTAMOS: Cálculo de Cuadros y Gastos (626/662)
   */
  saveFinancing: function(payload) {
    try {
      const isNew = !payload.id || payload.id === 'new';
      if(isNew) payload.id = _DB.getNextSequentialId("DB_FINANCING", "FIN");
      
      const capital = parseFloat(payload.capital);
      const apertura = parseFloat(payload.gastos_apertura || 0);
      
      if(apertura > 0 && isNew) {
         this._logAccountingMovement({
           cuenta: '626000000',
           concepto: `Gastos Apertura Préstamo ${payload.poliza}`,
           cargo: apertura,
           abono: 0,
           ref_id: payload.id
         });
      }

      payload.capital_pendiente = capital;
      _DB.save("DB_FINANCING", payload.id, payload);
      
      if(payload.generate_effects && payload.cuadro_amortizacion) {
         payload.cuadro_amortizacion.forEach((c, idx) => {
            const effId = `FIN-${payload.id}-${idx+1}`;
            _DB.save("DB_TREASURY_EFFECTS", effId, {
               id: effId, direction: 'OUTBOUND', status: c.pagado ? 'COBRADO' : 'PENDIENTE',
               importe: c.total_cuota, vencimiento: c.vencimiento,
               entity_name: payload.entidad, source_doc: payload.id,
               obs: `Cuota ${idx+1}/${payload.plazo_meses} Préstamo ${payload.poliza}`
            });
         });
      }

      return Response.success(payload, "Préstamo sincronizado.");
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * GESTIÓN DE REMESAS: Flujo Borrador -> Anticipo -> Liquidación
   */
  manageRemittance: function(payload) {
    try {
      const { action, id, selected_effects, status, banco_destino, norma, fecha_remesa } = payload;
      
      if (action === 'LIST') return Response.success(_DB.get("DB_REMITTANCES"));
      
      if (action === 'CREATE' || action === 'SAVE_AND_GENERATE') {
        const remId = id && id !== 'new' ? id : _DB.getNextSequentialId("DB_REMITTANCES", "REM");
        const total = selected_effects.reduce((s, e) => s + parseFloat(e.importe || 0), 0);
        
        const remittance = {
          id: remId,
          status: action === 'SAVE_AND_GENERATE' ? 'EMITIDA' : 'BORRADOR',
          banco_destino, norma, fecha_remesa,
          total: total,
          count: selected_effects.length,
          created_at: new Date().toISOString()
        };

        const allEffects = _DB.get("DB_TREASURY_EFFECTS") || [];
        selected_effects.forEach(se => {
          const e = allEffects.find(x => String(x.id) === String(se.id));
          if (e) {
            e.remittance_id = remId;
            if (action === 'SAVE_AND_GENERATE') e.status = 'REMESADO';
            _DB.save("DB_TREASURY_EFFECTS", e.id, e);
          }
        });

        _DB.save("DB_REMITTANCES", remId, remittance);
        return Response.success(remittance);
      }

      if (action === 'UPDATE') {
        const rem = _DB.get("DB_REMITTANCES").find(r => r.id === id);
        if (rem) {
          rem.status = status;
          _DB.save("DB_REMITTANCES", rem.id, rem);
        }
        return Response.success(null);
      }
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * MOTOR OÍDO CAJA: Procesamiento de voz financiero con Fuzzy Matching
   * @deprecated Usar AI_Controller.parseVoiceOrder para toda la lógica de voz.
   */
  _normalizeName: function(name) {
    if (!name) return "";
    return name.toString().toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+(s\.l\.|s\.a\.|slu|sa|sl)\.?/g, "")
      .trim();
  },

  processOidoCaja: function(text, sessionId) {
    return { ok: false, message: "Esta función está obsoleta. Use AI_Controller.parseVoiceOrder." };
  },

  confirmLiquidate: function(sessionId) {
    var cached = CacheService.getScriptCache().get(sessionId);
    if (!cached) return { status: 'ERROR', message: 'No hay propuesta pendiente.' };
    var proposal = JSON.parse(cached);
    var result = this.processLiquidacion({ effect_ids: [proposal.invoice_id], action: 'PAGAR', canal_pago: 'BANCO' });
    CacheService.getScriptCache().remove(sessionId);
    return result;
  },

  lockClientForDefault: function(clientId, effectId) {
    const clients = _DB.get("tenants") || [];
    const c = clients.find(cl => String(cl.id) === String(clientId));
    if (c) {
      c.bloqueado_impago = true;
      c.estado = 'Suspensión';
      c.motivo_estado = `IMPAGO AUTOMÁTICO (VÍNCULO D-): EFECTO ${effectId}`;
      _DB.save("tenants", c.id, c);
    }
  },

  _logAccountingMovement: function(m) {
     const id = _DB.getNextSequentialId("DB_MOVEMENTS", "MOV");
     _DB.save("DB_MOVEMENTS", id, { ...m, id, fecha: new Date().toISOString() });
  }
};

Module_Treasury.create_manual_expense = function(payload) {
  try {
    const { importe, vendor_id, cuenta, concepto } = payload;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. Registrar el movimiento en la hoja correspondiente
    if (importe < 0) {
      // Gasto: Registrar en DB_EXPENSES
      const sheet = ss.getSheetByName('DB_EXPENSES');
      if (!sheet) throw new Error("Hoja DB_EXPENSES no encontrada");
      // Asumiendo estructura: Fecha, Importe(abs), Proveedor, Concepto, Status
      sheet.appendRow([new Date(), Math.abs(importe), vendor_id, concepto, 'Pagado']);
    } else {
      // Ingreso: Registrar en DB_INVOICES
      const sheet = ss.getSheetByName('DB_INVOICES');
      if (!sheet) throw new Error("Hoja DB_INVOICES no encontrada");
      // Asumiendo estructura: Fecha, Importe, Cliente/Origen, Concepto
      sheet.appendRow([new Date(), importe, vendor_id, concepto]);
    }
    
    // 2. Actualizar saldo de la cuenta en DB_ACCOUNTS
    const accountsSheet = ss.getSheetByName('DB_ACCOUNTS');
    if (!accountsSheet) throw new Error("Hoja DB_ACCOUNTS no encontrada");
    
    const data = accountsSheet.getDataRange().getValues();
    let found = false;
    
    // Iterar buscando la cuenta (asumiendo columna 0 = ID Cuenta, columna 1 = Saldo)
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(cuenta)) {
        const currentBalance = parseFloat(data[i][1]) || 0;
        accountsSheet.getRange(i + 1, 2).setValue(currentBalance + importe);
        found = true;
        break;
      }
    }
    
    if (!found) throw new Error("Cuenta no encontrada para actualizar saldo: " + cuenta);
    
    // 3. Retornar éxito para el frontend
    return Response.success({ message: "Movimiento registrado y saldo actualizado correctamente." });
    
  } catch (e) {
    Logger.log("Error en create_manual_expense: " + e.message);
    return Response.error("Error en Module_Treasury: " + e.message);
  }
};
