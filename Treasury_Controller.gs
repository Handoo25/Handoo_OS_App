/**
 * Treasury_Controller.gs - ERP TITANIUM V216.0 (ATOMIC SETTLEMENT & AUTO-CLOSURE)
 */
var Treasury_Controller = {
  
  listAllEffects: function() {
    try {
      const data = _DB.get("DB_TREASURY_EFFECTS") || [];
      const tenants = _DB.get("tenants") || [];
      const vendors = _DB.get("DB_VENDORS") || [];
      const invoices = _DB.get("DB_INVOICES") || [];
      
      return Response.success(data.map(e => {
        let entityName = e.client_name || 'ENTIDAD DESCONOCIDA';
        if (e.direction === 'OUTBOUND') {
           const v = vendors.find(t => String(t.id) === String(e.vendor_id));
           if(v) entityName = v.nombre_fiscal;
           else if (e.beneficiario) entityName = e.beneficiario; 
        } else {
           const c = tenants.find(t => String(t.id) === String(e.client_id));
           if(c) entityName = c.nombre_fiscal;
        }
        const inv = invoices.find(i => i.id === e.invoice_id);
        return { 
          ...e, 
          entity_name: entityName, 
          fecha_emision: e.fecha_emision || inv?.fecha || e.created_at?.split('T')[0], 
          status: String(e.status || 'PENDIENTE').toUpperCase(), 
          importe: parseFloat(e.importe || 0) 
        };
      }).sort((a,b) => new Date(a.vencimiento) - new Date(b.vencimiento)));
    } catch(e) { return Response.error(e.message); }
  },

  updateEffect: function(p) {
    try {
      const all = _DB.get("DB_TREASURY_EFFECTS") || [];
      const e = all.find(x => x.id === p.id);
      if(!e) throw new Error("Efecto no localizado");
      Object.assign(e, p);
      _DB.save("DB_TREASURY_EFFECTS", e.id, e);
      Admin_Controller.updatePGCSaldos();
      return Response.success(e);
    } catch(e) { return Response.error(e.message); }
  },

  deleteEffect: function(p) {
    try {
      _DB.moveToTrash("DB_TREASURY_EFFECTS", p.id);
      Admin_Controller.updatePGCSaldos();
      return Response.success(null, "Efecto eliminado");
    } catch(e) { return Response.error(e.message); }
  },

  createManualEffect: function(p) {
    try {
      const id = _DB.getNextSequentialId("DB_TREASURY_EFFECTS", "EFE-MAN");
      const effect = {
        ...p,
        id: id,
        status: p.status || 'PENDIENTE',
        created_at: new Date().toISOString(),
        fecha_emision: new Date().toISOString().split('T')[0]
      };
      _DB.save("DB_TREASURY_EFFECTS", id, effect);
      Admin_Controller.updatePGCSaldos();
      return Response.success(effect);
    } catch(e) { return Response.error(e.message); }
  },

  listPendingEffectsByEntity: function(p) {
    try {
      const all = _DB.get("DB_TREASURY_EFFECTS") || [];
      return Response.success(all.filter(e => 
        (String(e.vendor_id) === String(p.entity_id) || String(e.client_id) === String(p.entity_id)) && 
        e.status === 'PENDIENTE'
      ));
    } catch(e) { return Response.error(e.message); }
  },

  create_manual_expense: function(p) {
    try {
      const id = _DB.getNextSequentialId("DB_TREASURY_EFFECTS", "EFE-EXP");
      const effect = {
        ...p,
        id: id,
        status: 'PENDIENTE DE TICKET',
        direction: 'OUTBOUND',
        created_at: new Date().toISOString(),
        fecha_emision: new Date().toISOString().split('T')[0]
      };
      _DB.save("DB_TREASURY_EFFECTS", id, effect);
      Admin_Controller.updatePGCSaldos();
      return Response.success(effect);
    } catch(e) { return Response.error(e.message); }
  },

  listFinancing: function() {
    try {
      const data = _DB.get("DB_FINANCING") || [];
      return Response.success(data.sort((a,b) => new Date(b.fecha_firma) - new Date(a.fecha_firma)));
    } catch(e) { return Response.error(e.message); }
  },

  saveFinancing: function(p) {
    return Module_Treasury.saveFinancing(p);
  },

  deleteFinancing: function(p) {
    try {
      _DB.moveToTrash("DB_FINANCING", p.id);
      return Response.success(null, "Financiación movida a papelera.");
    } catch(e) { return Response.error(e.message); }
  },

  listCreditLines: function() {
    try {
      const lines = _DB.get("DB_CREDIT_LINES") || [];
      const balances = Admin_Controller.updatePGCSaldos();
      const masters = _DB.get("MASTERS") || [];
      
      return Response.success(lines.map(l => {
         const bank = masters.find(m => m.type === 'BANK_ACCOUNT' && m.iban === l.poliza);
         if (bank) {
            const saldoPGC = parseFloat(balances[bank.ref_contable] || 0);
            l.dispuesto = saldoPGC < 0 ? Math.abs(saldoPGC) : 0;
            l.disponible = Math.max(0, parseFloat(l.capital_aprobado || 0) - l.dispuesto);
         } else {
            l.dispuesto = 0;
            l.disponible = parseFloat(l.capital_aprobado || 0);
         }
         return l;
      }));
    } catch(e) { return Response.error(e.message); }
  },

  saveCreditLine: function(p) {
    try {
      const isNew = !p.id || p.id === 'new';
      if (isNew) {
        p.id = _DB.getNextSequentialId("DB_CREDIT_LINES", "CRD");
        p.created_at = new Date().toISOString();
      }
      
      const masters = _DB.get("MASTERS") || [];
      let bankMaster = masters.find(m => m.type === 'BANK_ACCOUNT' && m.iban === p.poliza);
      
      if (!bankMaster) {
        bankMaster = {
          id: 'new',
          type: 'BANK_ACCOUNT',
          nombre: p.entidad + " (LÍNEA)",
          iban: p.poliza,
          swift: p.swift || 'CREDIT',
          pgc_root: '520',
          is_credit_line: true
        };
        const masterRes = Masters_Controller.save({ master: bankMaster });
        if (!masterRes.ok) throw new Error("Error creando maestro bancario: " + masterRes.msg);
      }

      _DB.save("DB_CREDIT_LINES", p.id, p);
      Admin_Controller.updatePGCSaldos();
      return Response.success(p, "Línea de circulante sincronizada.");
    } catch(e) { return Response.error(e.message); }
  },

  deleteCreditLine: function(p) {
    try {
      if (!p.id) return Response.error("ID Requerido");
      _DB.moveToTrash("DB_CREDIT_LINES", p.id);
      Admin_Controller.updatePGCSaldos();
      return Response.success(null, "Línea de crédito eliminada.");
    } catch(e) { return Response.error(e.message); }
  },

  executeDebtReclassification: function() {
    try {
      const financing = _DB.get("DB_FINANCING") || [];
      const movements = _DB.get("DB_MOVEMENTS") || [];
      const today = new Date();
      const currentYear = today.getFullYear();
      const nextYearLimit = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
      let count = 0;

      financing.forEach(f => {
        if (!f.cuadro_amortizacion) return;
        
        const checkId = "MOV-RECLASS-" + f.id + "-" + currentYear;
        const alreadyReclassified = movements.some(m => String(m.id).startsWith(checkId));
        
        if (alreadyReclassified) return; 

        const totalToReclassify = f.cuadro_amortizacion
          .filter(c => !c.pagado && new Date(c.vencimiento) <= nextYearLimit)
          .reduce((sum, c) => sum + parseFloat(c.capital_cuota), 0);

        if (totalToReclassify > 0) {
           _DB.save("DB_MOVEMENTS", checkId, {
              id: checkId,
              cuenta: "170000000",
              importe: totalToReclassify * -1,
              concepto: `[RECLASIFICACIÓN ANUAL] Deuda a C/P ${f.entidad}`,
              fecha: today.toISOString().split('T')[0]
           });
           _DB.save("DB_MOVEMENTS", checkId + "-IN", {
              id: checkId + "-IN",
              cuenta: "520000000",
              importe: totalToReclassify,
              concepto: `[RECLASIFICACIÓN ANUAL] Deuda a C/P ${f.entidad}`,
              fecha: today.toISOString().split('T')[0]
           });
           count++;
        }
      });

      Admin_Controller.updatePGCSaldos();
      return Response.success(null, `Proceso completado. ${count} financiaciones reclasificadas.`);
    } catch(e) { return Response.error(e.message); }
  },

  matchReconciliation: function(p) {
    try {
      const bMov = _DB.get("DB_BANK_MOVEMENTS").find(m => m.id === p.bank_movement_id);
      if(!bMov) throw new Error("Movimiento bancario no localizado.");
      
      const targetIds = Array.isArray(p.target_ids) ? p.target_ids : [p.target_id];
      const allEffects = _DB.get("DB_TREASURY_EFFECTS");
      const settingsRes = Admin_Controller.getSettings();
      const settings = settingsRes.data || settingsRes;
      const writeOffLimit = parseFloat(settings.write_off_limit || 1.0);
      let totalMatched = 0;

      targetIds.forEach(tid => {
        const effect = allEffects.find(e => e.id === tid);
        if(effect && effect.status !== 'COBRADO') {
          effect.status = 'COBRADO';
          effect.fecha_cobro_real = bMov.fecha;
          effect.canal_pago = p.bank_name;
          effect.matched_bank_mov_id = bMov.id; 
          totalMatched += parseFloat(effect.importe);
          _DB.save("DB_TREASURY_EFFECTS", effect.id, effect);
        }
      });

      const diff = Math.abs(parseFloat(bMov.importe)) - totalMatched;
      if (Math.abs(diff) > 0 && Math.abs(diff) <= writeOffLimit) {
        const accRedondeo = diff > 0 ? (settings.write_off_credit_acc || '768000000') : (settings.write_off_debit_acc || '668000000');
        _DB.save("DB_MOVEMENTS", "MOV-WO-" + Date.now(), { 
           cuenta: accRedondeo, 
           importe: diff * (parseFloat(bMov.importe) > 0 ? 1 : -1), 
           concepto: `[WRITE-OFF] Ajuste céntimos conciliación ${bMov.id}`, 
           fecha: bMov.fecha 
        });
      }

      bMov.matched = true;
      bMov.matched_ref = targetIds.join(',');
      bMov.matched_type = targetIds.length > 1 ? 'MULTI_MATCH' : 'SINGLE_MATCH';
      _DB.save("DB_BANK_MOVEMENTS", bMov.id, bMov);
      
      Admin_Controller.updatePGCSaldos();
      SpreadsheetApp.flush();
      return Response.success(null, "Sincronización de conciliación exitosa.");
    } catch(e) { return Response.error(e.message); }
  },

  undoMatch: function(p) {
    try {
      const bMov = _DB.get("DB_BANK_MOVEMENTS").find(m => m.id === p.bank_movement_id);
      if(!bMov) throw new Error("Movimiento bancario no localizado.");
      
      const allEffects = _DB.get("DB_TREASURY_EFFECTS");
      const matchedIds = String(bMov.matched_ref || '').split(',');
      
      matchedIds.forEach(id => {
         const effect = allEffects.find(e => e.id === id);
         if(effect) {
            effect.status = 'PENDIENTE';
            delete effect.fecha_cobro_real;
            delete effect.matched_bank_mov_id;
            _DB.save("DB_TREASURY_EFFECTS", effect.id, effect);
         }
      });
      
      bMov.matched = false; bMov.matched_ref = null; bMov.matched_type = null;
      _DB.save("DB_BANK_MOVEMENTS", bMov.id, bMov);
      
      Admin_Controller.updatePGCSaldos();
      SpreadsheetApp.flush();
      return Response.success(null, "Conciliación revertida. Efectos devueltos a cartera.");
    } catch(e) { return Response.error(e.message); }
  },

  executeInternalTransfer: function(p) {
    try {
      const { from_id, to_id, importe, fecha } = p;
      const amt = parseFloat(importe);
      if(!from_id || !to_id || isNaN(amt)) throw new Error("Datos insuficientes.");
      
      const masters = _DB.get("MASTERS") || [];
      const getAcc = (id) => {
        if (id === 'INTERNAL_CAJA') return '570000001';
        if (id === 'TPV') return '570000001';
        if (id === 'CAJA_FUERTE') return '570000002';
        if (id === 'TRANSITO') return '570000003';
        const b = masters.find(m => String(m.id) === String(id));
        return b ? b.ref_contable : null;
      };

      const sourceAcc = getAcc(from_id);
      const targetAcc = getAcc(to_id);
      if (!sourceAcc || !targetAcc) throw new Error("Cuentas contables no localizadas.");

      _DB.save("DB_MOVEMENTS", "MOV-TR-OUT-" + Date.now(), { cuenta: sourceAcc, importe: amt * -1, concepto: `[TRASPASO INTERNO] Salida de fondos`, fecha: fecha });
      _DB.save("DB_MOVEMENTS", "MOV-TR-IN-" + Date.now(), { cuenta: targetAcc, importe: amt, concepto: `[TRASPASO INTERNO] Entrada de fondos`, fecha: fecha });
      
      Admin_Controller.updatePGCSaldos();
      SpreadsheetApp.flush();
      return Response.success(null, "Traspaso de tesorería ejecutado.");
    } catch(e) { return Response.error(e.message); }
  },

  makeInternalTransfer: function(p) {
    return this.executeInternalTransfer(p);
  },

  generateSepaXML: function(payload) {
    try {
      const rem = _DB.get("DB_REMITTANCES").find(r => r.id === payload.id);
      if(!rem) throw new Error("Lote no localizado.");
      
      const effects = _DB.get("DB_TREASURY_EFFECTS").filter(e => String(e.remittance_id) === String(payload.id));
      const settings = Admin_Controller.getSettings().data;
      const company = settings.masters.companies.find(c => c.favorita) || settings.masters.companies[0];
      const now = new Date().toISOString();
      const direction = rem.direction || 'INBOUND';
      
      let xml = `<?xml version="1.0" encoding="UTF-8"?>`;
      
      if (direction === 'INBOUND') {
        xml += `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02"><CstmrDrctDbtInitn><GrpHdr><MsgId>REM-${rem.id}</MsgId><CreDtTm>${now}</CreDtTm><NbOfTxs>${effects.length}</NbOfTxs><CtrlSum>${effects.reduce((a,b)=>a+parseFloat(b.importe),0).toFixed(2)}</CtrlSum><InitgPty><Nm>${company.nombre_fiscal}</Nm></InitgPty></GrpHdr>`;
        effects.forEach(e => { xml += `<DrctDbtTxInf><PmtId><EndToEndId>${e.id}</EndToEndId></PmtId><InstdAmt Ccy="EUR">${parseFloat(e.importe).toFixed(2)}</InstdAmt><DrctDbtTx><MndtRltdInf><MndtId>MANDATE-${e.client_id}</MndtId></MndtRltdInf></DrctDbtTx><Dbtr><Nm>${e.client_name}</Nm></Dbtr></DrctDbtTxInf>`; });
        xml += `</CstmrDrctDbtInitn></Document>`;
      } else {
        xml += `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"><CstmrCdtTrfInitn><GrpHdr><MsgId>PAY-${rem.id}</MsgId><CreDtTm>${now}</CreDtTm><NbOfTxs>${effects.length}</NbOfTxs><CtrlSum>${effects.reduce((a,b)=>a+parseFloat(b.importe),0).toFixed(2)}</CtrlSum><InitgPty><Nm>${company.nombre_fiscal}</Nm></InitgPty></GrpHdr>`;
        effects.forEach(e => { xml += `<CdtTrfTxInf><PmtId><EndToEndId>${e.id}</EndToEndId></PmtId><Amt><InstdAmt Ccy="EUR">${parseFloat(e.importe).toFixed(2)}</InstdAmt></Amt><Cdtr><Nm>${e.entity_name || e.beneficiario}</Nm></Cdtr></CdtTrfTxInf>`; });
        xml += `</CstmrCdtTrfInitn></Document>`;
      }
      
      const folder = DriveApp.getFoldersByName("HANDOO_SEPA_XML").hasNext() ? DriveApp.getFoldersByName("HANDOO_SEPA_XML").next() : DriveApp.createFolder("HANDOO_SEPA_XML");
      const fileName = `${direction === 'INBOUND' ? 'COBRO' : 'PAGO'}_SEPA_${rem.id}.xml`;
      const file = folder.createFile(fileName, xml, "text/xml");
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      return Response.success({ url: file.getUrl() });
    } catch(e) { return Response.error(e.message); }
  },

  processLiquidacion: function(p) {
    return Module_Treasury.processLiquidacion(p);
  },

  processPartialLiquidacion: function(p) {
    try {
      const { effect_id, amount, canal_pago } = p;
      const amtToPay = parseFloat(amount);
      const allEff = _DB.get("DB_TREASURY_EFFECTS") || [];
      const original = allEff.find(e => e.id === effect_id);
      
      if (!original) throw new Error("Documento no localizado");
      const originalTotal = parseFloat(original.importe);
      
      if (amtToPay >= originalTotal) return this.processLiquidacion({ effect_ids: [effect_id], action: 'COBRAR', canal_pago });

      original.status = 'COBRADO';
      original.importe = amtToPay;
      original.canal_pago = canal_pago;
      original.fecha_cobro_real = new Date().toISOString();
      original.is_partial = true;
      _DB.save("DB_TREASURY_EFFECTS", original.id, original);

      const remainder = originalTotal - amtToPay;
      const newId = _DB.getNextSequentialId("DB_TREASURY_EFFECTS", "REM-" + (original.invoice_id || original.id));
      const newEff = {
        ...original,
        id: newId,
        status: 'PENDIENTE',
        importe: remainder,
        parent_id: original.id,
        remittance_id: null,
        fecha_cobro_real: null,
        is_partial: false,
        created_at: new Date().toISOString()
      };
      _DB.save("DB_TREASURY_EFFECTS", newId, newEff);

      Admin_Controller.updatePGCSaldos();
      return Response.success(null, "Liquidación parcial procesada. Saldo restante diferido.");
    } catch(e) { return Response.error(e.message); }
  },

  manageRemittance: function(p) {
    return Module_Treasury.manageRemittance(p);
  },

  getBankMovements: function(p) {
    try {
      const all = _DB.get("DB_BANK_MOVEMENTS") || [];
      const patterns = _DB.get("DB_TREASURY_LEARNING") || [];
      const bankMovements = all.filter(m => String(m.bank_account_id) === String(p.bank_account_id));
      
      return Response.success(bankMovements.map(m => {
         const cleanConcept = String(m.concepto).toUpperCase().replace(/[0-9]/g, '').trim();
         const match = patterns.find(pat => cleanConcept.includes(String(pat.pattern).toUpperCase().replace(/[0-9]/g, '').trim()));
         if (match && !m.matched) {
            m.suggestion = { account: match.account, label: match.label || 'Sugerencia Heurística' };
            m.smart_match = m.suggestion; 
         }
         return m;
      }).sort((a,b) => new Date(b.fecha) - new Date(a.fecha)));
    } catch(e) { return Response.error(e.message); }
  },

  get_daily_cash_journal: function() {
    try {
      const today = new Date().toISOString().split('T')[0];
      return this.getAccountLedger({
        cuenta: '570000001',
        start_date: today,
        end_date: today
      });
    } catch(e) { return Response.error(e.message); }
  },

  getAccountLedger: function(p) {
    try {
      const acc = p.cuenta;
      const start = p.start_date || '1970-01-01';
      const end = p.end_date || '9999-12-31';
      const movements = _DB.get("DB_MOVEMENTS") || [];
      const effects = _DB.get("DB_TREASURY_EFFECTS") || [];
      const masters = _DB.get("MASTERS") || [];
      const remittances = _DB.get("DB_REMITTANCES") || [];
      const invoices = _DB.get("DB_INVOICES") || [];
      const bank = masters.find(m => m.type === 'BANK_ACCOUNT' && m.ref_contable === acc);
      const isCaja = acc === '570000001';
      const isStripeVirtual = acc === 'STRIPE_VIRTUAL';

      let ledger = [];
      movements.filter(m => m.cuenta === acc).forEach(m => {
         ledger.push({ fecha: m.fecha, concepto: m.concepto, importe: parseFloat(m.importe), ref_id: m.ref_id || m.id, origin: 'MANUAL' });
      });
      effects.forEach(e => {
         if (e.status !== 'COBRADO') return;
         const rem = e.remittance_id ? remittances.find(r => String(r.id) === String(e.remittance_id)) : null;
         const isEffectInCash = String(e.metodo || '').toUpperCase().includes('EFECTIVO');
         const isStripe = String(e.metodo || '').toUpperCase().includes('STRIPE');
         
         let matchesAccount = false;
         if (isCaja && isEffectInCash) matchesAccount = true;
         else if (isStripeVirtual && isStripe) matchesAccount = true;
         else if (bank && !isEffectInCash && !isStripe) {
            if (e.canal_pago === bank.nombre || (rem && rem.banco_destino === bank.nombre)) matchesAccount = true;
         }
         
         if (matchesAccount) {
            let concept = `[LIQUIDACIÓN] ${e.entity_name || 'TITULAR'}`;
            if (e.invoice_id) { const inv = invoices.find(i => i.id === e.invoice_id); if(inv) concept += ` - FAC: ${inv.numero}`; }
            ledger.push({ fecha: e.fecha_cobro_real || e.vencimiento, concepto: concept, importe: parseFloat(e.importe) * (e.direction === 'OUTBOUND' ? -1 : 1), ref_id: e.invoice_id || e.id, origin: e.direction === 'OUTBOUND' ? 'EXPENSE' : 'INVOICE' });
         }
      });
      ledger.sort((a,b) => new Date(a.fecha) - new Date(b.fecha));
      let runningBalance = 0;
      let filteredLedger = [];
      ledger.forEach(item => {
         if (item.fecha < start) { runningBalance += item.importe; } 
         else if (item.fecha >= start && item.fecha <= end) {
            const rowBalance = runningBalance + item.importe;
            filteredLedger.push({ ...item, cargo: item.importe < 0 ? Math.abs(item.importe) : 0, abono: item.importe >= 0 ? item.importe : 0, saldo: rowBalance });
            runningBalance = rowBalance;
         }
      });
      return Response.success({ initial_balance: ledger.filter(i => i.fecha < start).reduce((s, i) => s + i.importe, 0), movements: filteredLedger.reverse() });
    } catch(e) { return Response.error(e.message); }
  },

  getCashFlowProjection: function() {
    try {
      const today = new Date();
      const balances = Admin_Controller.updatePGCSaldos();
      let currentLiquidity = 0;
      if (balances) {
        Object.keys(balances).forEach(acc => {
          if(acc && (acc.startsWith('570') || acc.startsWith('572'))) {
            currentLiquidity += (parseFloat(balances[acc]) || 0);
          }
        });
      }
      const effects = _DB.get("DB_TREASURY_EFFECTS") || [];
      const fixedCosts = Admin_Controller.getRealFixedCostsAverage();
      const dailyFixedCost = fixedCosts / 30;
      const projection = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        const dStr = d.toISOString().split('T')[0];
        const dayEffects = effects.filter(e => e.vencimiento === dStr && e.status === 'PENDIENTE');
        const dayInbound = dayEffects.filter(e => e.direction === 'INBOUND').reduce((s, e) => s + (parseFloat(e.importe) || 0), 0);
        const dayOutbound = dayEffects.filter(e => e.direction === 'OUTBOUND').reduce((s, e) => s + (parseFloat(e.importe) || 0), 0);
        currentLiquidity = currentLiquidity + dayInbound - dayOutbound - dailyFixedCost;
        projection.push({ label: d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }), balance: currentLiquidity, inbound: dayInbound, outbound: dayOutbound });
      }
      return Response.success(projection);
    } catch(e) { return Response.success([]); }
  },

  getRiskAnalytics: function(payload) {
    try {
      return Response.success({ real_risk: Module_Treasury.getRealRisk(payload.client_id) });
    } catch(e) { return Response.error(e.message); }
  },

  triggerDunning: function(payload) {
    return Module_Treasury.triggerDunning(payload);
  },

  saveSmartPattern: function(p) {
    try {
      const cleanPattern = String(p.pattern).toUpperCase().replace(/[0-9]/g, '').trim();
      if (cleanPattern.length < 3) return Response.error("Patrón demasiado corto para memorización segura.");
      
      const id = "PAT-" + Utilities.getUuid();
      _DB.save("DB_TREASURY_LEARNING", id, {
        id: id,
        pattern: cleanPattern,
        account: p.account,
        label: p.label || 'Pattern Aprendido por IA'
      });
      return Response.success(null, "Cerebro actualizado. Patrón heurístico guardado.");
    } catch(e) { return Response.error(e.message); }
  },

  saveManualBankMovement: function(p) {
    try {
      const id = "BNK-MAN-" + Date.now();
      const movement = {
        id: id,
        bank_account_id: p.bank_account_id,
        concepto: p.concepto.toUpperCase(),
        importe: parseFloat(p.importe),
        fecha: p.fecha || new Date().toISOString().split('T')[0],
        matched: false
      };
      _DB.save("DB_BANK_MOVEMENTS", id, movement);

      if (p.learn_pattern) {
        this.saveSmartPattern({
          pattern: p.concepto.toUpperCase(),
          account: p.target_account,
          label: "MEMORIA MANUAL"
        });
      }

      if (p.target_account) {
        _DB.save("DB_MOVEMENTS", "MOV-BNK-" + Date.now(), {
          cuenta: p.target_account,
          importe: parseFloat(p.importe) * -1,
          concepto: `[CONTRA BANCO] ${p.concepto}`,
          fecha: movement.fecha,
          ref_id: id
        });
      }

      Admin_Controller.updatePGCSaldos();
      return Response.success(movement, "Apunte registrado y sincronizado.");
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * Registra un movimiento de tesorería desde un gasto o ingreso.
   */
  registerMovement: function(p) {
    try {
      const id = "MOV-TRE-" + Date.now();
      const movement = {
        id: id,
        fecha: p.fecha || new Date().toISOString().split('T')[0],
        concepto: p.concepto.toUpperCase(),
        tipo: p.tipo === 'Entrada' ? 'SUMA' : 'RESTA',
        cantidad: Math.abs(parseFloat(p.importe)),
        canal: p.canal || 'BANCO',
        ref_id: p.ref_id,
        created_at: new Date().toISOString()
      };
      
      _DB.save("DB_MOVEMENTS", id, movement);
      
      // Si es un gasto pagado, también lo registramos como efecto liquidado si no existe
      if (p.ref_id && p.tipo === 'Salida') {
        const effectId = "PROV-" + p.ref_id;
        const effects = _DB.get("DB_TREASURY_EFFECTS") || [];
        const effect = effects.find(e => e.id === effectId);
        if (effect) {
          effect.status = 'PAGADO';
          effect.fecha_pago = p.fecha;
          _DB.save("DB_TREASURY_EFFECTS", effectId, effect);
        }
      }

      Admin_Controller.updatePGCSaldos();
      return Response.success(movement);
    } catch(e) { return Response.error(e.message); }
  },

  splitEffect: function(p) {
    try {
      const { parent_id, fractions } = p;
      const allEff = _DB.get("DB_TREASURY_EFFECTS") || [];
      const parent = allEff.find(e => e.id === parent_id);
      if(!parent) throw new Error("Efecto original no localizado");

      parent.status = 'ANULADO_POR_SPLIT';
      _DB.save("DB_TREASURY_EFFECTS", parent.id, parent);

      fractions.forEach((f, idx) => {
        const id = _DB.getNextSequentialId("DB_TREASURY_EFFECTS", "SPL-" + parent.id);
        const fraction = {
          ...parent, 
          id: id,
          status: 'PENDIENTE',
          importe: parseFloat(f.importe),
          vencimiento: f.vencimiento,
          parent_id: parent.id,
          created_at: new Date().toISOString(),
          is_split: true,
          split_order: idx + 1
        };
        delete fraction.fecha_cobro_real;
        delete fraction.matched_bank_mov_id;
        delete fraction.remittance_id;
        
        _DB.save("DB_TREASURY_EFFECTS", id, fraction);
      });

      Admin_Controller.updatePGCSaldos();
      return Response.success(null, "Plan de fraccionamiento ejecutado.");
    } catch(e) { return Response.error(e.message); }
  },

  findAutonomousMatches: function(p) {
    try {
      const bankMovements = _DB.get("DB_BANK_MOVEMENTS").filter(m => String(m.bank_account_id) === String(p.bank_account_id) && !m.matched);
      const effects = _DB.get("DB_TREASURY_EFFECTS").filter(e => e.status === 'PENDIENTE' || e.status === 'REMESADO');
      
      const autonomousMatches = [];
      
      bankMovements.forEach(mov => {
        const amount = Math.abs(parseFloat(mov.importe));
        const direction = mov.importe >= 0 ? 'INBOUND' : 'OUTBOUND';
        const movDate = new Date(mov.fecha);
        
        const match = effects.find(eff => {
          const effAmount = parseFloat(eff.importe);
          const effDirection = eff.direction || 'INBOUND';
          const effDate = new Date(eff.vencimiento);
          
          const sameAmount = Math.abs(amount - effAmount) < 0.01;
          const sameDirection = direction === effDirection;
          const dateDiff = Math.abs(movDate - effDate) / (1000 * 60 * 60 * 24);
          
          return sameAmount && sameDirection && dateDiff <= 7;
        });

        if (match) {
          autonomousMatches.push({
            bank_mov_id: mov.id,
            effect_id: match.id,
            bank_concept: mov.concepto,
            entity_name: match.entity_name || match.client_name,
            amount: amount,
            date: mov.fecha
          });
        }
      });

      return Response.success(autonomousMatches);
    } catch(e) { return Response.error(e.message); }
  },

  importBankCSV: function(p) {
    try {
      const { bank_account_id, rows } = p;
      rows.forEach(r => {
        const id = "BNK-IMP-" + Utilities.getUuid();
        _DB.save("DB_BANK_MOVEMENTS", id, {
          id: id,
          bank_account_id: bank_account_id,
          fecha: r.fecha,
          concepto: r.concepto,
          importe: parseFloat(r.importe),
          matched: false
        });
      });
      return Response.success(null, "Extracto importado correctamente.");
    } catch(e) { return Response.error(e.message); }
  },

  execute_daily_closure: function(p) {
    try {
      const id = _DB.getNextSequentialId("DB_CASH_CLOSINGS", "CLOSING");
      const closing = {
        id: id,
        date: new Date().toISOString().split('T')[0],
        tpv_real: parseFloat(p.tpv_real),
        saldo_teorico: parseFloat(p.saldo_teorico),
        user: 'admin',
        status: 'COMPLETED',
        observaciones: p.observaciones || '',
        validated_movement_ids: p.validated_movement_ids || []
      };
      _DB.save("DB_CASH_CLOSINGS", id, closing);

      if (p.excedente_to_caja_fuerte && p.surplus > 0) {
        this.executeInternalTransfer({
          from_id: 'TPV',
          to_id: 'CAJA_FUERTE',
          importe: p.surplus,
          fecha: closing.date
        });
      }

      Admin_Controller.updatePGCSaldos();
      return Response.success(null, "Cierre diario ejecutado correctamente.");
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * TITANIUM ATOMIC SETTLEMENT: Gasto + Pago + Match + Smart Pattern
   */
  imputeMovementAsExpense: function(p) {
    try {
      const bMov = _DB.get("DB_BANK_MOVEMENTS").find(m => m.id === p.bank_movement_id);
      if(!bMov) throw new Error("Movimiento bancario no localizado.");

      // 1. Crear Gasto (DB_EXPENSES)
      const expenseId = "EXP-INST-" + Date.now();
      const expense = {
        id: expenseId,
        vendor_id: p.vendor_id,
        concepto: p.concept,
        importe: Math.abs(bMov.importe),
        fecha: bMov.fecha,
        pgc_account: p.pgc_account,
        status: 'CONTABILIZADO'
      };
      _DB.save("DB_EXPENSES", expenseId, expense);

      // 2. Crear Efecto de Tesorería ya COBRADO/PAGADO
      const effectId = "EFE-INST-" + Date.now();
      const effect = {
        id: effectId,
        expense_id: expenseId,
        vendor_id: p.vendor_id,
        importe: Math.abs(bMov.importe),
        vencimiento: bMov.fecha,
        status: bMov.importe < 0 ? 'PAGADO' : 'COBRADO',
        direction: bMov.importe < 0 ? 'OUTBOUND' : 'INBOUND',
        fecha_cobro_real: bMov.fecha,
        matched_bank_mov_id: bMov.id
      };
      _DB.save("DB_TREASURY_EFFECTS", effectId, effect);

      // 3. Ejecutar Match de Conciliación
      bMov.matched = true;
      bMov.matched_ref = effectId;
      bMov.matched_type = 'INSTANT_EXPENSE';
      _DB.save("DB_BANK_MOVEMENTS", bMov.id, bMov);

      // 4. Smart Pattern
      if (p.remember) {
        this.saveSmartPattern({
          pattern: p.concept,
          account: p.pgc_account,
          label: `Patrón para ${p.concept}`
        });
      }
    // 5. Actualizar saldos contables
      Admin_Controller.updatePGCSaldos();
      return Response.success(null);
    } catch(e) { return Response.error(e.message); }
  }
};
