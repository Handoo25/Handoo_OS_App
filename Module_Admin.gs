/**
 * Module_Admin.gs - TITANIUM CORE v108.0 (INDUSTRIAL EXPANSION)
 */

var _DB = {
  MANIFEST: [
    { name: "tenants", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_VENDORS", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "RECYCLE_BIN", headers: ["ID", "JSON_DATA", "METADATA", "ORIGIN_SHEET", "DELETED_AT"] },
    { name: "DB_INVOICES", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "SETTINGS_V70", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "MASTERS", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "SUBSCRIPTIONS", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_EXPENSES", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_EFFECTS", headers: ["ID", "JSON_DATA", "METADATA"] }, // ⭐ NUEVA: Tesorería para la IA
    { name: "DB_EXPENSE_ORDERS", headers: ["ID", "JSON_DATA", "METADATA"] }, // ⭐ NUEVA: Pedidos por voz
    { name: "DB_MOVEMENTS", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_TREASURY_EFFECTS", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_REMITTANCES", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_BANK_MOVEMENTS", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_TREASURY_LEARNING", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_FINANCING", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_CREDIT_LINES", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_STRATEGY_SNAPSHOTS", headers: ["ID", "JSON_DATA", "METADATA"] },
    // TABLAS DE OPERACIONES Y COMPLIANCE V108
    { name: "DB_PURCHASE_ORDERS", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_DELIVERY_NOTES", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_APPCC_LOGS", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_INVENTORY_LOGS", headers: ["ID", "JSON_DATA", "METADATA"] },
    // ESTRUCTURA DE ESCANDALLOS VIVOS (V190)
    // MASTERS (tipo PRODUCT): + max_volatility_perc
    // DB_FORMULAS: + margen_objetivo_perc
    { name: "DB_FORMULAS", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_FORMULA_ITEMS", headers: ["ID", "JSON_DATA", "METADATA"] },
    // TABLAS DE PERSONAL V108
    { name: "DB_STAFF_SCHEDULES", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_STAFF_LOGS", headers: ["ID", "JSON_DATA", "METADATA"] },
    // NUEVA TABLA V112: COLA DE ENTRADA EXTERNA (ALEXA/WHATSAPP)
    { name: "DB_INBOX_QUEUE", headers: ["ID", "JSON_DATA", "METADATA"] },
    // NUEVAS TABLAS V115: CONTROL FINANCIERO AVANZADO (INYECCIÓN QUIRÚRGICA)
    { name: "DB_COST_CENTERS", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_FIXED_ASSETS", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_RECURRING_EXPENSES", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_OPERATIONAL_TOOLS", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_AMORTIZATION_RULES", headers: ["ID", "JSON_DATA", "METADATA"] },
    // NUEVAS TABLAS V118: DATA BRIDGE (IMPORT/EXPORT)
    { name: "DB_MIGRATION_MAPPING", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_MIGRATION_QUARANTINE", headers: ["ID", "JSON_DATA", "METADATA"] },
    // TABLA DE AUDITORÍA (REPARACIÓN V125)
    { name: "DB_AUDIT_LOGS", headers: ["ID", "JSON_DATA", "METADATA"] },
    // NUEVAS TABLAS DE OPERACIÓN INDUSTRIAL (V126)
    { name: "DB_PENDING_ORDERS", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_STAFF_CONSUMPTIONS", headers: ["ID", "JSON_DATA", "METADATA"] },
    // TABLAS CRÍTICAS INVENTARIO V3.0
    { name: "DB_UNIT_CONVERSIONS", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_SHIFTS", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_EVENTS", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_PLATE_WASTE_LOGS", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_QUARANTINE", headers: ["ID", "JSON_DATA", "METADATA"] },
    { name: "DB_NEURAL_INBOX", headers: ["ID", "JSON_DATA", "METADATA"] }
  ],

  _ensureSheet: function(name) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      const config = this.MANIFEST.find(m => m.name === name);
      const headers = config ? config.headers : ["ID", "JSON_DATA", "METADATA"];
      sheet = ss.insertSheet(name);
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#0f172a").setFontColor("#ffffff");
      SpreadsheetApp.flush();
    }
    return sheet;
  },

  initializeStructure: function() {
    this.MANIFEST.forEach(m => this._ensureSheet(m.name));
    return Response.success(null, "Estructura Titanium v108 Sincronizada");
  },

  getNextSequentialId: function(sheetName, prefix, padding = 4) {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(30000);
      const sheet = this._ensureSheet(sheetName);
      if (sheet.getLastRow() <= 1) return prefix + "-" + "1".padStart(padding, '0');
      
      const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat();
      
      const filteredNumbers = ids
        .filter(id => {
          const s = String(id);
          if (!s.startsWith(prefix + "-")) return false;
          const parts = s.split('-');
          const numPart = parts[parts.length - 1];
          return numPart && /^\d+$/.test(numPart);
        })
        .map(id => {
          const parts = String(id).split('-');
          return parseInt(parts[parts.length - 1]);
        });
      
      const nextNum = filteredNumbers.length > 0 ? (Math.max(...filteredNumbers) + 1) : 1;
      return prefix + "-" + String(nextNum).padStart(padding, '0');
    } finally {
      lock.releaseLock();
    }
  },

  getNextSubAccount: function(root) {
    const masters = this.get("MASTERS");
    const rStr = String(root);
    const existingAccounts = masters
      .filter(m => {
        const acc = String(m.ref_contable || '');
        return acc.startsWith(rStr) && acc.length === 9;
      })
      .map(m => {
        const seqPart = String(m.ref_contable).substring(3);
        const num = parseInt(seqPart);
        return isNaN(num) ? 0 : num;
      });
    
    const nextSeq = existingAccounts.length > 0 ? (Math.max(...existingAccounts) + 1) : 1;
    return rStr + String(nextSeq).padStart(6, '0');
  },

  isUnique: function(sheetName, fieldName, value, excludeId = null) {
    const data = this.get(sheetName);
    return !data.some(item => item[fieldName] === value && item.id !== excludeId);
  },

  _getSheet: function(name) {
    return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  },

  get: function(sheetName) {
    try {
      const sheet = this._ensureSheet(sheetName);
      if (sheet.getLastRow() <= 1) {
        console.log(`DEBUG: _DB.get - Sheet ${sheetName} is empty.`);
        return [];
      }
      const colCount = sheetName === "RECYCLE_BIN" ? 5 : 3;
      const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, colCount).getValues();
      console.log(`DEBUG: _DB.get - Sheet ${sheetName} has ${rows.length} rows.`);
      return rows.map(r => {
        try {
          const d = JSON.parse(r[1]);
          // LIMPIEZA SOBERANA: Quitamos espacios ocultos del ID (el "Index")
          d.id = String(r[0]).trim(); 
          if(sheetName === "RECYCLE_BIN") {
            d._origin_sheet = r[3];
            d._deleted_at = r[4];
          }
          return d;
        } catch(e) { return null; }
      }).filter(x => x !== null);
    } catch(e) { 
      console.error(`DEBUG: _DB.get - Error in ${sheetName}:`, e.message);
      return []; 
    }
  },

  save: function(sheetName, id, data) {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(30000);
      let sheet = this._ensureSheet(sheetName);
      const lastRow = sheet.getLastRow();
      const ids = lastRow > 0 ? sheet.getRange(1, 1, lastRow, 1).getValues().flat().map(String) : [];
      const idx = ids.indexOf(String(id));
      const payload = JSON.stringify(data);
      const metadata = `v108_${new Date().getTime()}`;
      if (idx > 0) { 
        sheet.getRange(idx + 1, 2, 1, 2).setValues([[payload, metadata]]);
      } else {
        sheet.appendRow([String(id), payload, metadata]);
      }
      SpreadsheetApp.flush();
      return true;
    } catch(e) { throw new Error("ERROR CRÍTICO DB: " + e.message); } finally { lock.releaseLock(); }
  },

  moveToTrash: function(sheetName, id) {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(30000);
      const sheet = this._getSheet(sheetName);
      const trash = this._ensureSheet("RECYCLE_BIN");
      if (!sheet) return false;
      const ids = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues().flat().map(String);
      const idx = ids.indexOf(String(id));
      if (idx > 0) {
        const rowData = sheet.getRange(idx + 1, 1, 1, 3).getValues()[0];
        trash.appendRow([rowData[0], rowData[1], rowData[2], sheetName, new Date().toISOString()]);
        sheet.deleteRow(idx + 1);
        SpreadsheetApp.flush();
        return true;
      }
      return false;
    } finally { lock.releaseLock(); }
  },

  getSetting: function(key, defaultValue = null) {
    const all = this.get("SETTINGS_V70");
    // Búsqueda insensible a espacios al principio o al final
    const found = all.find(s => s.id && String(s.id).trim() === String(key).trim());
    if (!found) return defaultValue;
    
    let value = found.value !== undefined ? found.value : found;
    
    // Si el valor viene "sucio" como un string que parece un array, lo parseamos
    if (typeof value === 'string' && value.startsWith('[')) {
      try { value = JSON.parse(value); } catch(e) { console.error("Error en setting: " + key); }
    }
    return value;
  },

  delete: function(sheetName, id) {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(30000);
      const sheet = this._getSheet(sheetName);
      if (!sheet) return false;
      const ids = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues().flat().map(String);
      const idx = ids.indexOf(String(id));
      if (idx > 0) {
        sheet.deleteRow(idx + 1);
        SpreadsheetApp.flush();
        return true;
      }
      return false;
    } finally { lock.releaseLock(); }
  }
};

var Module_Admin = {
  _cache: null,
  // Estos son los nombres que YA TIENES en tu JSON de la imagen
  FEATURES: [
    "FEAT_INVENTORY_ADVANCED", // Tu llave maestra
    "FEAT_RECIPES",           // Escandallos
    "FEAT_STOCK_ALERTS",      // Alertas predictivas
    "FEAT_OIDO_CHEF"          // Operaciones
  ],
  checkAccess: function(featureCode) {
    // 1. Cargamos los módulos una sola vez por ejecución
    if (!this._cache) {
      this._cache = _DB.getSetting("ACTIVE_MODULES", []);
      // Si por error viene como string (por las comillas del Excel), lo limpiamos
      if (typeof this._cache === 'string') {
        try { this._cache = JSON.parse(this._cache); } catch(e) { this._cache = []; }
      }
    }

    const activeModules = this._cache;
    
    // 2. MAPEADOR DE COMPATIBILIDAD
    let searchCode = featureCode;
    if (featureCode === "FEAT_INVENTORY_FULL") searchCode = "FEAT_INVENTORY_ADVANCED";
    if (featureCode === "FEAT_INVENTORY_RECIPES") searchCode = "FEAT_RECIPES";
    
    // 3. LOGICA DE PERMISOS
    // Si tiene la llave maestra de inventario, le damos paso a las funciones de stock
    const isInventoryFeature = featureCode.includes("INVENTORY") || featureCode.includes("STOCK") || featureCode === "FEAT_RECIPES";
    if (isInventoryFeature && activeModules.includes("FEAT_INVENTORY_ADVANCED")) return true;

    // Para todo lo demás (Ventas, Gastos, etc.), comprobamos su código específico
    return activeModules.includes(searchCode);
  }
};

Module_Admin.checkAndInitDatabase = function() {
  const tablesToVerify = [
    { name: "DB_EXPENSE_ORDERS", description: "Borradores de pedidos por voz" },
    { name: "DB_EFFECTS", description: "Vencimientos, préstamos y tesorería" },
    { name: "DB_EVENTS", description: "Historial de eventos y foodies" }
  ];

  const logs = [];

  tablesToVerify.forEach(table => {
    let data = _DB.get(table.name);
    
    // Si la tabla no existe o es null, la inicializamos
    if (data === null || data === undefined) {
      // Creamos un array vacío para que los .filter() y .reduce() no fallen
      _DB.save(table.name, "INIT_MARKER", { 
        created_at: new Date().toISOString(), 
        info: "Tabla inicializada por sistema Titanium",
        is_placeholder: true 
      });
      logs.push(`✅ Tabla ${table.name} creada correctamente.`);
    }
  });

  return logs.length > 0 ? logs.join("\n") : "Sinfonía perfecta: todas las tablas existen.";
};

/**
 * PUENTE TITANIUM: Subida directa de Facturas para OCR y Visor (Bypass Enrutador)
 */
function TITANIUM_upload_expense_file(payload) {
  try {
    const { base64, fileName, mimeType } = payload;
    const data = base64.split(',')[1];
    const blob = Utilities.newBlob(Utilities.base64Decode(data), mimeType, fileName);
    
    // Busca o crea la carpeta de facturas automáticamente
    let folder;
    const folders = DriveApp.getFoldersByName("HANDOO_FACTURAS_OCR");
    if (folders.hasNext()) {
        folder = folders.next();
    } else {
        folder = DriveApp.createFolder("HANDOO_FACTURAS_OCR");
    }
    
    const file = folder.createFile(blob);
    
    // Devuelve el ID de Drive para que el visor lo pueda pintar en pantalla
    return { ok: true, data: { drive_id: file.getId() } };
  } catch(e) {
    return { ok: false, msg: e.message };
  }
}
/**
 * FUNCIÓN PUENTE: Ejecuta esto desde el menú para crear las hojas.
 */
function setup_Titanium_Structure() {
  const result = _DB.initializeStructure();
  Logger.log(result.msg);
}
/**
 * REPARACIÓN AUTOMÁTICA TITANIUM
 * Ejecuta esta función para arreglar el "Fallo de Red" y recuperar pestañas.
 */
function TITANIUM_Emergency_Repair() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("SETTINGS_V70");
  if (!sheet) return Logger.log("No se encontró la hoja SETTINGS_V70");

  const lastRow = sheet.getLastRow();
  const range = sheet.getRange(2, 1, lastRow - 1, 2);
  const values = range.getValues();

  // 1. Limpieza de IDs y JSONs
  const cleanedValues = values.map(row => {
    let id = String(row[0]).trim(); // Quita espacios ocultos en el ID
    let data = row[1];

    if (id === "ACTIVE_MODULES") {
      try {
        // Intenta limpiar el JSON si está mal formateado
        let parsed = JSON.parse(data);
        if (typeof parsed === 'string') parsed = JSON.parse(parsed);
        data = JSON.stringify(parsed);
      } catch (e) {
        Logger.log("Aviso: El formato de ACTIVE_MODULES parece extraño, pero intentaremos procesarlo.");
      }
    }
    return [id, data];
  });

  range.setValues(cleanedValues);
  
  // 2. Limpieza de caché (si existiera)
  if (typeof Module_Admin !== 'undefined') {
    Module_Admin._cache = null;
  }

  SpreadsheetApp.flush();
  Logger.log("✅ Reparación completada. Los espacios han sido eliminados y el JSON normalizado.");
}

/**
 * IMPORTADOR MASIVO DE CATÁLOGO (JSON)
 * Recibe un array de objetos desde el frontend y los inyecta en la pestaña MASTERS.
 */
/**
 * IMPORTADOR MASIVO DE CATÁLOGO (JSON)
 * Recibe un array de objetos desde el frontend y los inyecta en la pestaña MASTERS.
 */
function api_inventory_bulk_import(payload) {
  try {
    const items = payload.items;
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("DB_MIGRATION_QUARANTINE");
    if (!sheet) return { ok: false, msg: "Error: No se encuentra la zona de Cuarentena." };

    const newRows = [];
    const now = new Date();
    const timestamp = now.getTime();

    items.forEach((item, index) => {
      const id = "MIG-" + timestamp + index;
      const data = {
        nombre: item.nombre.trim(),
        unidad: item.unidad.trim(),
        precio: parseFloat(item.precio) || 0,
        merma: parseFloat(item.merma) || 0,
        status: "PENDIENTE", // Marcamos para revisión
        imported_at: now.toISOString()
      };

      newRows.push([id, JSON.stringify(data), "v108_import"]);
    });

    if (newRows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 3).setValues(newRows);
    }

    return { ok: true, msg: "¡Aterrizaje completado! " + newRows.length + " artículos están en Cuarentena esperando categoría." };
  } catch (e) {
    return { ok: false, msg: "Error: " + e.message };
  }
}
/**
 * PURGA DE SEGURIDAD (VACIAR CATÁLOGO DE PRODUCTOS)
 */
function api_inventory_purge_catalog() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("MASTERS");
    if (!sheet) return { ok: false, msg: "Error: No se encuentra la base de datos MASTERS." };

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { ok: true, msg: "El catálogo ya está vacío." };

    const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    const rowsToDelete = [];

    // Buscamos todas las filas que sean productos (IDs que empiezan por MST-PRODUCT)
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]).startsWith("MST-PRODUCT-")) {
        rowsToDelete.push(i + 2); // +2 porque los arrays empiezan en 0 y la cabecera es la fila 1
      }
    }

    // Borramos de abajo hacia arriba para que no se desordenen las filas al borrar
    for (let i = rowsToDelete.length - 1; i >= 0; i--) {
      sheet.deleteRow(rowsToDelete[i]);
    }

    return { ok: true, msg: "Catálogo purgado. Todo limpio." };
  } catch (e) {
    return { ok: false, msg: "Error al purgar: " + e.message };
  }
}
/**
 * BORRADO MASIVO POR SELECCIÓN
 * Recibe un array de IDs desde el frontend y los elimina de MASTERS.
 */
function api_inventory_bulk_delete(payload) {
  try {
    const idsToDelete = payload.ids;
    if (!idsToDelete || idsToDelete.length === 0) return { ok: false, msg: "No hay elementos seleccionados." };

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("MASTERS");
    if (!sheet) return { ok: false, msg: "Error: No se encuentra la BD MASTERS." };

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { ok: false, msg: "El catálogo está vacío." };

    const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    const rowsToDelete = [];

    // Buscamos las filas exactas que coinciden con los IDs que enviaste
    for (let i = 0; i < data.length; i++) {
      if (idsToDelete.includes(String(data[i][0]))) {
        rowsToDelete.push(i + 2); // +2 por índice cero y fila de cabecera
      }
    }

    // Borramos SIEMPRE de abajo hacia arriba para que no salten las filas
    for (let i = rowsToDelete.length - 1; i >= 0; i--) {
      sheet.deleteRow(rowsToDelete[i]);
    }

    return { ok: true, msg: "Se han fulminado " + rowsToDelete.length + " artículos correctamente." };
  } catch (e) {
    return { ok: false, msg: "Error al borrar: " + e.message };
  }
}
/**
 * OBTIENE LOS PRODUCTOS PENDIENTES DE IMPORTACIÓN
 */
function api_inventory_get_migration_quarantine() {
  try {
    const data = _DB.get("DB_MIGRATION_QUARANTINE");
    return { ok: true, data: data };
  } catch (e) {
    return { ok: false, msg: e.toString() };
  }
}

/**
 * PROCESA Y GRADÚA PRODUCTOS DE CUARENTENA AL CATÁLOGO REAL
 */
function api_inventory_process_quarantine_migration(payload) {
  try {
    const { items, globalType } = payload; // items: array de IDs, globalType: RAW, SUPPLY...
    const quarantineData = _DB.get("DB_MIGRATION_QUARANTINE");
    const mastersSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("MASTERS");
    const quarantineSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("DB_MIGRATION_QUARANTINE");
    
    const newRows = [];
    const now = new Date();
    const timestamp = now.getTime();

    items.forEach((id, index) => {
      const itemData = quarantineData.find(q => q.id === id);
      if (!itemData) return;

      const newId = "MST-PRODUCT-" + timestamp + index;
      const json = {
        type: globalType,
        nombre: itemData.nombre,
        consume_unit: itemData.unidad,
        last_purchase_price: itemData.precio,
        merma_perc: itemData.merma,
        updated_at: now.toISOString()
      };

      newRows.push([newId, JSON.stringify(json), "v108_graduated"]);
    });

    if (newRows.length > 0) {
      // 1. Inyectamos en MASTERS
      mastersSheet.getRange(mastersSheet.getLastRow() + 1, 1, newRows.length, 3).setValues(newRows);
      
      // 2. Limpiamos la zona de cuarentena (borramos los IDs procesados)
      const qIds = quarantineSheet.getRange(2, 1, quarantineSheet.getLastRow() - 1, 1).getValues().flat();
      for (let i = qIds.length - 1; i >= 0; i--) {
        if (items.includes(String(qIds[i]))) {
          quarantineSheet.deleteRow(i + 2);
        }
      }
    }

    return { ok: true, msg: "¡Éxito! " + newRows.length + " artículos graduados al Catálogo Global." };
  } catch (e) {
    return { ok: false, msg: e.toString() };
  }
}
