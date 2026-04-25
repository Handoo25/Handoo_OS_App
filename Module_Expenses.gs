/**
 * Module_Expenses.gs - TITANIUM EXPENSE BUSINESS LOGIC
 * Motor de reglas de negocio pesadas para compras y gastos.
 */
var Module_Expenses = {

  /**
   * Sube el documento a Google Drive y devuelve el ID
   */
  persistInDrive: function(b64Data, mimeType, fileName, vendorName) {
    try {
      const rootFolder = DriveApp.getFoldersByName("HANDOO_INVOICES").hasNext() ? 
                         DriveApp.getFoldersByName("HANDOO_INVOICES").next() : 
                         DriveApp.createFolder("HANDOO_INVOICES");
                         
      let vendorFolder;
      const vFolders = rootFolder.getFoldersByName(vendorName || "GENERAL");
      if(vFolders.hasNext()) vendorFolder = vFolders.next();
      else vendorFolder = rootFolder.createFolder(vendorName || "GENERAL");

      const blob = Utilities.newBlob(Utilities.base64Decode(b64Data), mimeType, fileName);
      const file = vendorFolder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      
      return file.getId();
    } catch(e) {
      console.error("Error en Drive: " + e.message);
      return null;
    }
  },

  /**
   * Inyecta los items del gasto directamente en el stock de Inventario
   */
  pushToInventory: function(expenseId) {
    try {
      const expense = Repository.getById(expenseId);
      if(!expense) throw new Error("Documento no encontrado: " + expenseId);
      
      if (expense.items && expense.items.length > 0) {
        expense.items.forEach(it => {
          if (!it.master_id) return;
          
          const conversion = _DB.get("DB_UNIT_CONVERSIONS", it.master_id);
          const factor = conversion ? parseFloat(conversion.conversion_factor) : 1;
          const finalQty = parseFloat(it.qty) * factor;
          
          const movementId = "MOV-INV-" + Date.now() + "-" + it.master_id;
          _DB.save("DB_MOVEMENTS", movementId, {
            id: movementId,
            producto_id: it.master_id,
            cantidad: finalQty,
            tipo: 'SUMA',
            fecha: new Date().toISOString(),
            is_inventory_adjustment: true
          });
          
          const master = _DB.get("MASTERS").find(m => m.id === it.master_id);
          if (master) {
            master.stock = (parseFloat(master.stock) || 0) + finalQty;
            _DB.save("MASTERS", master.id, master);
          }
        });
      }
      return true;
    } catch(e) {
      throw new Error("Fallo al inyectar en inventario: " + e.message);
    }
  },

  /**
   * Registro de incidencias logísticas en tesorería (Claims Shield)
   */
  registerIncident: function(payload) {
    const { docId, amount, reason, vendorId } = payload;
    const claimId = "CLM-" + Date.now();
    const effectId = "PROV-" + claimId;
    
    _DB.save("DB_TREASURY_EFFECTS", effectId, {
      id: effectId,
      expense_id: claimId,
      vendor_id: vendorId,
      importe: parseFloat(amount),
      vencimiento: new Date().toISOString().split('T')[0],
      status: 'COBRADO',
      direction: 'INBOUND',
      metodo: 'COMPENSACION',
      obs: "RECLAMACIÓN LOGÍSTICA: " + reason
    });
    return claimId;
  },

  /**
   * Sincroniza un gasto pagado con el flujo de caja de Tesorería.
   */
  syncWithTreasury: function(expense) {
    if (expense.status !== 'Pagado') return false;
    
    const move = {
      fecha: expense.fecha,
      concepto: `[GASTO ${expense.categoria || 'GENERAL'}] ${expense.beneficiario} - REF: ${expense.id}`,
      tipo: 'Salida',
      importe: parseFloat(expense.total),
      canal: expense.canal_pago || 'Banco',
      ref_id: expense.id
    };
    
    // Sincronización con el Mayor de Tesorería
    if (typeof Treasury_Controller !== 'undefined' && Treasury_Controller.registerMovement) {
       Treasury_Controller.registerMovement(move);
    }
    
    return true; 
  }
};
