/**
 * Code.gs - ERP TITANIUM (ROUTER V125.1 - FULL RESTORATION)
 */

function doGet(e) {
  var template = HtmlService.createTemplateFromFile('Index');
  
  // Usamos 'view' como nombre oficial para la ruta
  template.view = e.parameter.v || 'Dashboard'; 
  
  return template.evaluate()
    .setTitle('HANDOO OS - TITANIUM')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * GATEWAY DE ENTRADA EXTERNA V118 (ALEXA / AGORA / WEBHOOKS)
 * Permite recibir comandos de voz y tickets de TPV en tiempo real.
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    // RUTA A: COMANDOS DE VOZ (ALEXA)
    if(data.text) {
       return ContentService.createTextOutput(JSON.stringify(AI_Controller.handleExternalCapture(data)))
              .setMimeType(ContentService.MimeType.JSON);
    }
    
    // RUTA B: ÁGORA TPV WEBHOOK (TIEMPO REAL)
    if(data.agora_event || data.OrderNumber) {
       return ContentService.createTextOutput(JSON.stringify(DataBridge_Controller.handleAgoraWebhook(data)))
              .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: false, msg: "Unsupported webhook payload" }))
           .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, msg: err.message }))
           .setMimeType(ContentService.MimeType.JSON);
  }
}

function include(filename) {
  try {
    console.log("Including file: " + filename);
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch(e) { 
    console.error("CRITICAL ERROR including file: " + filename, e);
    return `<script>console.error("CRITICAL: Failed to include ${filename}. Error: ${e.message}");</script><!-- Error: ${filename} -->`; 
  }
}

var Response = {
  success: (data, msg = "OK") => ({ ok: true, data: data, msg: msg, ts: Date.now() }),
  error: (msg) => ({ ok: false, msg: msg, ts: Date.now() })
};

function runDailyBilling() {
  console.log("Iniciando Ciclo de Facturación Robotizado...");
  const count = Module_Subscription.runBillingRobot();
  console.log(`Ciclo completado. Facturas/Pagos procesados: ${count}`);
}

var Formulas_Controller = {
  getList: function() {
    return Inventory_Controller.listFormula();
  }
};

/**
 * API GATEWAY TITANIUM: Único punto de entrada para llamadas desde el cliente.
 */
function api(route, payload) {
  // 1. MAPA DE PERMISOS (Candado Real)
  const PERMISSIONS = {
    'strategy.get_projections': 'FEAT_STRATEGY',
    'admin.get_performance_report': 'FEAT_PERFORMANCE',
    'admin.get_stats': null,
    'inventory.get_catalog': null,
    'inventory.get_stock_movements': 'FEAT_INVENTORY_FIFO',
    'inventory.get_kardex_logs': 'FEAT_INVENTORY_FIFO',
    'treasury.get_cash_flow': null,
    'invoice.get_history': 'FEAT_CORE_INVOICING',
    'expense.list': 'FEAT_CORE_EXPENSES',
    'expense.upload_file': 'FEAT_CORE_EXPENSES',
    'expense.save': 'FEAT_CORE_EXPENSES',
    'expense.delete': 'FEAT_CORE_EXPENSES',
    'expense.find_matches': 'FEAT_CORE_EXPENSES',
    'expense.find_pending_orders': 'FEAT_CORE_EXPENSES',
    'expense.check_duplicate': 'FEAT_CORE_EXPENSES',
    'expense.register_incident': 'FEAT_CORE_EXPENSES',
    'expense.push_to_inventory': 'FEAT_CORE_EXPENSES',
    'vendor.list': 'FEAT_CORE_EXPENSES',
    'formula.get_live_costs': 'FEAT_INVENTORY_ADVANCED',
    'formula.ask_ai': 'FEAT_FORMULAS_AI',
    'formula.list': 'FEAT_INVENTORY_ADVANCED',
    'formula.save': 'FEAT_INVENTORY_ADVANCED'
  };

  // 🔥 BYPASS SOBERANO: Rutas del núcleo siempre abiertas para el sistema base
  const CORE_BYPASS_ROUTES = [
      'expense.list', 
      'vendor.list', 
      'invoice.get_history',
      'admin.get_settings',
      'admin.get_stats',
      'inventory.get_catalog',
      'inventory.get_kardex_logs'
  ];

  const requiredFeature = PERMISSIONS[route];
  const isBypass = CORE_BYPASS_ROUTES.includes(route) || route.startsWith('treasury.') || route.startsWith('expense.');
  
  if (requiredFeature && !isBypass) {
    if (typeof Module_Admin !== 'undefined' && !Module_Admin.checkAccess(requiredFeature)) {
      return Response.error("Módulo no incluido en su suscripción actual.");
    }
  }

  // 2. ROUTE MAP (ACTUALIZADO CON RUTAS FALTANTES)
  const ROUTE_MAP = {
    // ADMIN & KERNEL
    'auth.login': () => Auth_Controller.login(payload),
    'admin.init_db': () => _DB.initializeStructure(),
    'admin.check_and_init_db': () => _DB.initializeStructure(),
    'admin.get_stats': () => Admin_Controller.getDashboardStats(),
    'admin.get_settings': () => Admin_Controller.getSettings(),
    'admin.get_movements': () => Admin_Controller.getMovements(),
    'admin.save_settings': () => Admin_Controller.saveSettings(payload),
    'admin.save_movement': () => Admin_Controller.saveMovement(payload),
    'admin.restore_item': () => Admin_Controller.restoreItem(payload),
    'admin.purge_item': () => Admin_Controller.purgeItem(payload),
    'admin.clear_trash': () => Admin_Controller.clearTrash(),
    'admin.omni_search': () => Admin_Controller.omniSearch(payload),
    'admin.get_vat_report': () => Admin_Controller.getVATReport(payload),
    'admin.get_performance_report': () => Admin_Controller.getPerformanceReport(),
    'admin.get_fixed_assets': () => Patrimony_Controller.listFixedAssets(),
    'admin.save_fixed_asset': () => Patrimony_Controller.saveFixedAsset(payload),
    'admin.delete_fixed_asset': () => Patrimony_Controller.deleteFixedAsset(payload),
    'admin.get_operational_tools': () => Patrimony_Controller.listOperationalTools(),
    'admin.save_operational_tool': () => Patrimony_Controller.saveOperationalTool(payload),
    'admin.delete_operational_tool': () => Patrimony_Controller.deleteOperationalTool(payload),
    'admin.get_inbox': () => Response.success(_DB.get("DB_INBOX_QUEUE")),
    'admin.delete_inbox_item': () => Response.success(_DB.delete("DB_INBOX_QUEUE", payload.id)),
    'admin.get_cost_centers': () => Response.success(_DB.get("DB_COST_CENTERS")),
    'admin.save_cost_center': () => Admin_Controller.saveCostCenter(payload),
    'admin.delete_cost_center': () => Response.success(_DB.delete("DB_COST_CENTERS", payload.id)),
    'admin.generate_cc_code': () => Response.success(Admin_Controller.generateCostCenterCode(payload.name)),
    'admin.get_amortization_rules': () => Patrimony_Controller.listAmortizationRules(),
    'admin.save_amortization_rule': () => Patrimony_Controller.saveAmortizationRule(payload),
    'admin.delete_amortization_rule': () => Patrimony_Controller.deleteAmortizationRule(payload),
    'admin.get_pending_alerts': () => Admin_Controller.get_pending_alerts(),

    // TREASURY (LAS QUE FALTABAN)
    'treasury.list_all_effects': () => Treasury_Controller.listAllEffects(),
    'treasury.get_cash_flow': () => Treasury_Controller.getCashFlowProjection(),
    'treasury.get_bank_movements': () => Treasury_Controller.getBankMovements(payload),
    'treasury.process_liquidacion': () => Treasury_Controller.processLiquidacion(payload),

    // EXPENSES (UNIFICADO A SINGULAR)
    'expense.list': () => Expense_Controller.list(),
    'expense.save': () => Expense_Controller.save(payload),
    'expense.delete': () => Expense_Controller.delete(payload),
    'expense.find_matches': () => Expense_Controller.findMatches(payload),
    'expense.find_pending_orders': () => Expense_Controller.findPendingOrders(payload),
    'expense.check_duplicate': () => Expense_Controller.checkPotentialDuplicate(payload),
    'expense.push_to_inventory': () => Expense_Controller.pushToInventory(payload),
    'expense.upload_file': () => Expense_Controller.uploadTempFile(payload),
    'expense.send_email': () => Expense_Controller.sendEmailWithAttachment(payload),
    'expense.save_document': () => Expense_Controller.saveDocumentToDrive(payload.base64, payload.fileName, payload.expId),
    'expense.sync_with_treasury': () => Expense_Controller.syncWithTreasury(payload),
    'expense.save_draft_order': () => Orders_Controller.saveDraftOrder(payload),
    'expense.get_pending_orders': () => Orders_Controller.getPendingOrders(),
    'expense.confirm_receipt': () => Orders_Controller.confirmReceipt(payload),

    // INVENTORY
    'inventory.get_catalog': () => Inventory_Controller.getCatalog(),
    'inventory.get_stock_movements': () => Inventory_Controller.get_stock_movements(),
    'inventory.get_kardex_logs': () => Inventory_Controller.get_kardex_logs(),
    'inventory.save_master': () => Inventory_Controller.saveMaster(payload),
    
    // --- RUTAS DE PRODUCCIÓN ---
    'production.save': () => Production_Controller.save(payload),
    'production.executeProduction': () => Production_Controller.executeProduction(payload),
    'production.simulate_fifo': () => Production_Controller.simulate_fifo(payload),
    'production.get_history': () => Production_Controller.getHistory(),
    'production.update_log': () => Production_Controller.update_log(payload),
    'production.cancel_production': () => Production_Controller.cancel_production(payload),
    'production.audit_batch': () => Production_Controller.audit_batch(payload), // 🔥 LÍNEA NUEVA
    'production.get_daily_prep': () => Production_Controller.get_daily_prep(),

    // --- RUTAS DE ALÉRGENOS ---
    'allergens.get_list': () => Allergens_Controller.getList(),
    'allergens.save': () => Allergens_Controller.save(payload),
    'allergens.delete': () => Allergens_Controller.delete(payload),
    'allergens.generate_pdf': () => Allergens_Controller.generate_pdf(payload),
    'allergens.upload_icon_to_drive': () => Allergens_Controller.upload_icon_to_drive(payload),
    'allergens.api_get_drive_images': () => Allergens_Controller.api_get_drive_images(),

    // FORMULAS
    'formulas.get_list': () => Formulas_Controller.getList(),
    'formula.get_live_cost': () => Inventory_Controller.getLiveCost(payload.formulaId),
    'formula.list': () => Inventory_Controller.listFormula(),
    'formula.get_live_costs': () => Inventory_Controller.getBulkLiveCosts(payload),
    'formula.save': () => Inventory_Controller.saveFormula(payload),
    'formula.delete': () => Response.success(_DB.moveToTrash("DB_FORMULAS", payload.id)), 

    // NETWORK
    'network.get_peers': () => Response.success(_DB.get("tenants").filter(c => c.handoo_network === true)),

    // MASTERS
    'masters.get_by_type': () => Masters_Controller.listByType(payload.type),
    'masters.save': () => Masters_Controller.save(payload),
    'masters.delete': () => Masters_Controller.delete(payload),
    
    // PLATFORM (CLIENTS)
    'platform.get_clients': () => Platform_Controller.list(),
    'platform.save_client': () => Platform_Controller.save(payload),
    'platform.delete_client': () => Platform_Controller.delete(payload),
    'platform.get_trash': () => Platform_Controller.listTrash(),
    
    // INVOICING
    'invoice.get_drafts': () => Invoice_Controller.listDrafts(),
    'invoice.get_history': () => Invoice_Controller.listHistory(),
    'invoice.approve': () => Invoice_Controller.approveDrafts(payload),
    'invoice.get_pdf': () => Invoice_Controller.getPDF(payload),
    'invoice.delete': () => Invoice_Controller.delete(payload),
    'invoice.send_batch_emails': () => Invoice_Controller.sendBatchEmails(payload),
    'invoice.create_manual': () => Invoice_Controller.createManualDraft(payload),
    'invoice.save_manual': () => Invoice_Controller.saveManualInvoice(payload),
    'invoice.gen_batch': () => Invoice_Controller.generateDraftsBatch(),

    // SUBSCRIPTIONS
    'subscription.list': () => Subscription_Controller.list(),
    'subscription.save': () => Subscription_Controller.save(payload),
    'subscription.delete': () => Subscription_Controller.delete(payload),
    'subscription.get_auto_status': () => Subscription_Controller.getAutomationStatus(),
    'subscription.save_auto_config': () => {
       _DB.save("SETTINGS_V70", "AUTO_BILLING_ACTIVE", { value: payload.active });
       _DB.save("SETTINGS_V70", "AUTO_BILLING_HOUR", { value: payload.hour });
       return Response.success(null);
    },

    // VENDORS
    'vendor.list': () => Vendor_Controller.list(),
    'vendor.save': () => Vendor_Controller.save(payload),
    'vendor.delete': () => Vendor_Controller.delete(payload),
    'vendor.get_history': () => Vendor_Controller.getHistory(payload),
    'vendor.get_tariff': () => Response.success({ items: (payload.vendor_id ? (_DB.get("MASTERS").filter(m => m.aliases && m.aliases.some(a => String(a.vendor_id) === String(payload.vendor_id))).map(m => { const al = m.aliases.find(a => String(a.vendor_id) === String(payload.vendor_id)); return { ref: al.vendor_ref, concept: m.nombre, price: al.tariff_price || al.last_price }; })) : []) }),
    'vendor.save_tariff': () => Inventory_Controller.saveTariff(payload),

    // TREASURY ADDITIONAL
    'treasury.manage_remittance': () => Treasury_Controller.manageRemittance(payload),
    'treasury.process_liquidacion': () => Treasury_Controller.processLiquidacion(payload),
    'treasury.process_partial_liquidacion': () => Treasury_Controller.processPartialLiquidacion(payload),
    'treasury.update_effect': () => Treasury_Controller.updateEffect(payload),
    'treasury.delete_effect': () => Treasury_Controller.deleteEffect(payload),
    'treasury.create_manual_effect': () => Treasury_Controller.createManualEffect(payload),
    'treasury.import_bank_csv': () => Treasury_Controller.importBankCSV(payload),
    'treasury.save_manual_bank_movement': () => Treasury_Controller.saveManualBankMovement(payload),
    'treasury.register_movement': () => Treasury_Controller.registerMovement(payload),
    'treasury.match_reconciliation': () => Treasury_Controller.matchReconciliation(payload),
    'treasury.undo_match': () => Treasury_Controller.undoMatch(payload),
    'treasury.internal_transfer': () => Treasury_Controller.executeInternalTransfer(payload),
    'treasury.get_sepa_xml': () => Treasury_Controller.generateSepaXML(payload),
    'treasury.get_risk_analytics': () => Treasury_Controller.getRiskAnalytics(payload),
    'treasury.trigger_dunning': () => Treasury_Controller.triggerDunning(payload),
    'treasury.split_effect': () => Treasury_Controller.splitEffect(payload),
    'treasury.find_autonomous_matches': () => Treasury_Controller.findAutonomousMatches(payload),
    'treasury.list_financing': () => Treasury_Controller.listFinancing(),
    'treasury.save_financing': () => Treasury_Controller.saveFinancing(payload),
    'treasury.delete_financing': () => Treasury_Controller.deleteFinancing(payload),
    'treasury.list_credit_lines': () => Treasury_Controller.listCreditLines(),
    'treasury.save_credit_line': () => Treasury_Controller.saveCreditLine(payload),
    'treasury.delete_credit_line': () => Treasury_Controller.deleteCreditLine(payload),
    'treasury.reclassify_debt': () => Treasury_Controller.executeDebtReclassification(),
    'treasury.get_ledger': () => Treasury_Controller.getAccountLedger(payload),
    'treasury.save_smart_pattern': () => Treasury_Controller.saveSmartPattern(payload),

    // INVENTORY ADDITIONAL
    'inventory.run_migration': () => Inventory_Controller.run_migration(),
    'inventory.register_waste': () => Inventory_Controller.save_plate_waste(payload),
    'inventory.register_waste_classified': () => Inventory_Controller.register_waste_classified(payload),
    'inventory.save_plate_waste': () => Inventory_Controller.save_plate_waste(payload),
    'inventory.save_shift': () => Inventory_Controller.save_shift(payload),
    'inventory.delete_master': () => Inventory_Controller.deleteMaster(payload),
    'inventory.conciliate_quarantine': () => Inventory_Controller.conciliate(payload),
    'inventory.get_quarantine': () => Inventory_Controller.getQuarantine(),
    'inventory.get_predictive_alerts': () => Inventory_Controller.getPredictiveAlerts(),
    'inventory.get_all_conversions': () => Inventory_Controller.get_all_conversions(),
    'inventory.get_market_best_price': () => Inventory_Controller.getMarketBestPrice(payload),
    'inventory.adjust_stock': () => Inventory_Controller.adjust_stock(payload),

    // STRIPE
    'stripe.save_config': () => Stripe_Controller.saveConfig(payload),
    'stripe.sync_customer': () => Stripe_Controller.syncCustomer(payload),
    'stripe.manual_charge': () => Treasury_Controller.manualStripeCharge(payload),

    // AUTOPILOT
    'autopilot.execute_scan': () => Module_Autopilot.runAutonomousReconciliation(),
    'autopilot.process_burst_batch': () => Module_Autopilot.process_burst_batch(payload),
    'autopilot.scan_mail': () => Module_GInbound.scanGmailInbox(),
    'admin.get_full_state': () => Admin_Controller.getFullState(),
    'admin.get_settings': () => Admin_Controller.getSettings(),
    'admin.save_settings': () => Admin_Controller.saveSettings(payload),
    'admin.get_profile': () => Response.success({ email: Session.getActiveUser().getEmail(), nombre: "ADMINISTRADOR" }),
    'debug.get_raw_settings': () => Response.success(_DB.get("SETTINGS_V70")),

    // TEAM & RRHH
    'team.get_all': () => Team_Controller.list(),
    'team.save': () => Team_Controller.save(payload),
    'team.delete': () => Team_Controller.delete(payload),
    'team.purge': () => Team_Controller.purge(payload),
    'team.verify_pin': () => Team_Controller.verifyPIN(payload.pin),
    'team.register_consumption': () => RRHH_Controller.registerConsumption(payload),
    'team.get_consumptions': () => RRHH_Controller.getConsumptions(),

    // STRATEGY
    'strategy.get_projections': () => Admin_Controller.getStrategicProjections(),
    'strategy.generate_quarterly_closing': () => Admin_Controller.generateQuarterlyClosing(payload),
    
    // AI NEURAL
    'ai.get_ai_context': () => AI_Controller.getAIContext(),
    'ai.ask_cfo': () => AI_Controller.askCFO(payload),
    'ai.process_document': () => AI_Controller.processDocument(payload),
    'ai.analyzeInventoryPhoto': () => AI_Controller.processInventoryPhoto(payload),
    'ai.resolveBarcode': () => AI_Controller.resolveBarcode(payload),
    'ai.generateAutoOrder': () => AI_Controller.generateAutoOrder(payload),
    'ai.saveInventoryFromScanner': () => AI_Controller.saveInventoryFromScanner(payload),
    'ai.parse_voice_order': () => AI_Controller.parseVoiceOrder(payload),
    'ai.get_oido_chef_quarantine': () => AI_Controller.getOidoChefQuarantine(),
    'ai.get_proactive_insights': () => AI_Controller.getProactiveInsights(),

    // DATA BRIDGE
    'bridge.import_agora_products': () => DataBridge_Controller.importAgoraProducts(payload),
    'bridge.get_quarantine': () => DataBridge_Controller.getQuarantine(),
    'bridge.resolve_mapping': () => DataBridge_Controller.resolveMapping(payload),
    'bridge.export_gestoria': () => DataBridge_Controller.exportGestoriaPack(payload),
    'bridge.import_odoo_csv': () => DataBridge_Controller.processOdooCSV(payload),
    'bridge.import_vendor_tariff': () => DataBridge_Controller.importVendorTariffCSV(payload)
  };

  try {
    if (ROUTE_MAP[route]) return ROUTE_MAP[route]();
    return Response.error(`Ruta no válida: ${route}`);
  } catch (e) {
    return Response.error(e.message);
  }
}

/**
 * Crea un recordatorio en el calendario del trabajador o de cocina
 */
function createHandooAlert(email, titulo, descripcion, fechaHora) {
  try {
    const cal = CalendarApp.getCalendarById(email) || CalendarApp.getDefaultCalendar();
    
    // Creamos un evento de 15 minutos como "Alerta"
    const start = new Date(fechaHora);
    const end = new Date(start.getTime() + 15 * 60000);
    
    cal.createEvent(titulo, start, end, {
      description: descripcion,
      guests: email,
      sendInvites: true
    });
    
    return true;
  } catch (e) {
    console.error("Error creando alerta de calendario: " + e.message);
    return false;
  }
}

/**
 * Envía el recordatorio diario a todos los empleados activos
 * Se puede configurar para que corra a las 16:30 y 23:30
 */
function sendDailyStaffReminders() {
  const staff = (_DB.get("DB_TEAM") || []).filter(s => s.active && s.email);
  
  staff.forEach(employee => {
    const subject = "📝 Handoo OS: Registro de Consumo Pendiente";
    const body = `Hola ${employee.name},\n\nNo olvides registrar tu comida o consumos de hoy en el Portal de Autoconsumo de Handoo OS para que podamos cuadrar el inventario correctamente.\n\nGracias.`;
    
    // 1. Envío de Gmail
    MailApp.sendEmail(employee.email, subject, body);
    
    // 2. Inyección en Google Calendar (Evento de 15 min)
    createHandooAlert(employee.email, "🍔 Registrar Consumo Staff", "Portal de Autoconsumo Handoo OS", new Date());
  });
}

/**
 * CONTROLADOR DE RECURSOS HUMANOS Y AUTOCONSUMO
 */
var RRHH_Controller = {
    registerConsumption: function(payload) {
        try {
            // Añadimos la fecha y hora exactas del momento en que el trabajador mete el PIN
            payload.fecha = new Date().toLocaleString('es-ES');
            payload.timestamp = Date.now();
            
            // Guardamos el ticket en una tabla nueva exclusiva para esto
            _DB.save("DB_STAFF_CONSUMPTIONS", 'LOG_' + payload.timestamp, payload);
            return Response.success(payload);
        } catch(e) {
            return Response.error("Error guardando consumo: " + e.message);
        }
    },
    
    getConsumptions: function() {
        try {
            // Leemos todos los tickets guardados para mostrarlos en la Auditoría
            const data = _DB.get("DB_STAFF_CONSUMPTIONS");
            return Response.success(data || []);
        } catch(e) {
            // Si la tabla es nueva y aún no hay datos, devolvemos una lista vacía para no dar error
            return Response.success([]); 
        }
    }
};

// Función que se ejecutaría por Trigger de tiempo para la cocina
function triggerKitchenWasteCheck() {
  const allSettings = _DB.get("SETTINGS_V70");
  const morningTime = (allSettings.find(s => s.id === "alert_time_morning") || {value: "16:30"}).value;
  const nightTime = (allSettings.find(s => s.id === "alert_time_night") || {value: "23:30"}).value;
  
  // Aquí la lógica para ver qué hora es y mandar el aviso de "Mermas del turno"
  createHandooAlert("cocina@handoo.app", "📝 AUDITORÍA DE MERMAS", "Es hora de registrar las mermas del turno en Handoo OS.", new Date());
}

/**
 * CONTROLADOR DE COMPRAS Y PEDIDOS EN TRÁNSITO
 */
var Orders_Controller = {
    saveDraftOrder: function(payload) {
        try {
            // Guardamos el pedido en la base de datos de pedidos pendientes
            _DB.save("DB_PENDING_ORDERS", payload.id, payload);
            return Response.success(payload);
        } catch(e) {
            return Response.error("Error guardando pedido: " + e.message);
        }
    },
    
    getPendingOrders: function() {
        try {
            const data = _DB.get("DB_PENDING_ORDERS");
            return Response.success(data || []);
        } catch(e) {
            return Response.success([]); 
        }
    },

    confirmReceipt: function(payload) {
        try {
            console.log("DEBUG: Iniciando confirmReceipt", JSON.stringify(payload));
            let masters = _DB.get("MASTERS");
            if (!masters || (Array.isArray(masters) && masters.length === 0)) {
                masters = _DB.get("DB_CATALOG") || [];
            }
            
            let products = Array.isArray(masters) ? masters : (masters.products || []);
            if (products.length === 0) return Response.error("No se encontraron productos en el catálogo maestro.");

            let updatedCount = 0;
            let logs = [];
            const timestamp = Date.now();
            const fechaStr = new Date().toLocaleString('es-ES');

            payload.items.forEach(item => {
                const qty = parseFloat(item.qty);
                if (qty > 0) {
                    const cleanId = String(item.id).trim();
                    const pIdx = products.findIndex(p => String(p.id).trim() === cleanId);
                    
                    if (pIdx !== -1) {
                        const original = products[pIdx];
                        const actual = parseFloat(original.stock_actual || original.stock || 0);
                        const nuevoStock = actual + qty;
                        
                        // Actualización de propiedades
                        original.stock_actual = nuevoStock;
                        original.stock = nuevoStock;
                        original.updated_at = new Date().toISOString();

                        // Registro individual de movimiento
                        const logId = 'LOG_' + timestamp + '_' + cleanId;
                        const logEntry = {
                            id: logId,
                            timestamp: timestamp,
                            fecha: fechaStr,
                            producto_id: cleanId,
                            producto_nombre: original.nombre || original.name || item.name, 
                            tipo: 'SUMA',
                            cantidad: qty,
                            unidad: item.format || original.unidad_medida || 'UD',
                            concept: 'RECEPCIÓN PEDIDO: ' + (payload.order_id || 'S/N'),
                            is_inventory_adjustment: true
                        };
                        
                        // Guardamos registro en ambas tablas por si acaso (Compatibilidad V3.0)
                        _DB.save("DB_KARDEX_LOGS", logId, logEntry);
                        _DB.save("DB_INVENTORY_LOGS", logId, logEntry);
                        
                        // Guardamos el cambio en MASTERS inmediatamente para máxima integridad
                        _DB.save("MASTERS", original.id, original);
                        
                        updatedCount++;
                        logs.push(`${original.nombre}: ${actual} -> ${nuevoStock}`);
                    } else {
                        logs.push(`ERR: Producto ${cleanId} no hallado.`);
                    }
                }
            });

            if (updatedCount > 0) {
                // Limpiar pedido de tránsito si existe
                if (payload.order_id) {
                    _DB.delete("DB_PENDING_ORDERS", payload.order_id);
                    _DB.delete("DB_PURCHASE_ORDERS", payload.order_id); // Limpieza doble
                }
                Admin_Controller.updatePGCSaldos(); // Actualizar balances financieros si aplica
                return Response.success({ count: updatedCount, details: logs }, "Entrada de almacén procesada. Stock actualizado.");
            } else {
                return Response.error("No se pudo procesar ningún artículo. Revise los IDs y el catálogo. Detalles: " + logs.join(' | '));
            }
        } catch(e) {
            console.error("ERROR CRITICO confirmReceipt:", e);
            return Response.error("Fallo técnico en Kernel: " + e.message);
        }
    },
};

function DIAGNOSTICO_HANDOO() {
  const tablas = ["DB_CATALOG", "DB_INVENTORY", "DB_PRODUCTS", "MASTERS", "DB_MASTERS"];
  tablas.forEach(t => {
    let data = _DB.get(t);
    if(data) console.log("TABLA ENCONTRADA: " + t + " -> Contenido: " + JSON.stringify(data).substring(0,100));
  });
}
