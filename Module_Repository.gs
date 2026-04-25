/**
 * Module_Repository.gs - Capa de Acceso a Datos (DAL) Centralizada
 * Prepara el ERP para una futura migración a SQL.
 */

var Repository = (function() {
  
  // Función privada de validación
  function _validate(data, requiredFields) {
    if (!data) throw new Error("Datos inválidos para la operación.");
    
    requiredFields.forEach(function(field) {
      if (data[field] === undefined || data[field] === null || data[field] === "") {
        throw new Error("Campo obligatorio faltante: " + field);
      }
    });
    return true;
  }

  return {
    /**
     * Busca un documento en cualquier tabla de compras basándose en su prefijo.
     */
    getById: function(id) {
      if (!id) return null;
      const sid = String(id);
      let table = "";
      if (sid.startsWith("EXP-") || sid.startsWith("GST-")) table = "DB_EXPENSES";
      else if (sid.startsWith("ALB-")) table = "DB_DELIVERY_NOTES";
      else if (sid.startsWith("ORD-")) table = "DB_PURCHASE_ORDERS";
      
      if (!table) return null;
      const docs = _DB.get(table) || [];
      return docs.find(d => String(d.id) === sid);
    },

    // --- EXPENSES ---
    Expenses: {
      getAll: function() {
        return _DB.get("DB_EXPENSES") || [];
      },
      getById: function(id) {
        var expenses = _DB.get("DB_EXPENSES") || [];
        return expenses.find(function(e) { return e.id === id; });
      },
      save: function(expense) {
        // CORRECCIÓN TITANIUM: Usamos 'fecha' y 'total' en lugar de 'date' y 'amount'
        _validate(expense, ["id", "fecha", "total"]);
        return _DB.save("DB_EXPENSES", expense.id, expense);
      },
      delete: function(id) {
        return _DB.delete("DB_EXPENSES", id);
      }
    },

    // --- INBOX (Neural Inbox) ---
    Inbox: {
      getAll: function() {
        return _DB.get("DB_INBOX_QUEUE") || [];
      },
      save: function(item) {
        // Definir campos obligatorios para Inbox
        _validate(item, ["id", "payload", "timestamp"]);
        return _DB.save("DB_INBOX_QUEUE", item.id, item);
      },
      delete: function(id) {
        return _DB.delete("DB_INBOX_QUEUE", id);
      },
      processItem: function(id) {
        // Lógica para el "Neural Inbox"
        var item = this.getById(id);
        if (!item) throw new Error("Item no encontrado en Inbox.");
        // Aquí iría la lógica de procesamiento neural
        return item;
      }
    }
  };
})();