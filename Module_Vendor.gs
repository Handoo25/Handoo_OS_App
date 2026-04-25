/**
 * Module_Vendor.gs - TITANIUM PROCUREMENT LOGIC
 */
var Module_Vendor = {

  /**
   * Actualiza el histórico de precios de compra para un proveedor y producto.
   */
  updatePriceMemory: function(vendor_id, product_name, price) {
    const vendors = _DB.get("DB_VENDORS") || [];
    const v = vendors.find(x => String(x.id) === String(vendor_id));
    if(v) {
      if(!v.price_memory) v.price_memory = {};
      const key = String(product_name).toUpperCase().trim();
      v.price_memory[key] = parseFloat(price);
      _DB.save("DB_VENDORS", v.id, v);
      return true;
    }
    return false;
  },

  /**
   * Verifica si un proveedor puede ser eliminado sin romper el libro diario.
   */
  checkIntegrity: function(vendorId) {
    const expenses = _DB.get("DB_EXPENSES") || [];
    const deps = expenses.filter(e => String(e.vendor_id) === String(vendorId)).length;
    return { safe: deps === 0, count: deps };
  }
};