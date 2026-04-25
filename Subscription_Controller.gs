/**
 * Subscription_Controller.gs - TITANIUM V1.2
 */
var Subscription_Controller = {

  list: function() {
    try {
      const subs = _DB.get("SUBSCRIPTIONS") || [];
      const clients = _DB.get("tenants") || [];
      const masters = _DB.get("MASTERS") || [];
      
      return Response.success(subs.map(s => {
        const client = clients.find(c => c.id === s.client_id) || { nombre_fiscal: 'S/N' };
        const itemName = s.item_type === 'PLAN' ? 
              (masters.find(m => m.id === s.plan_id)?.nombre || 'PLAN S/N') : 
              (masters.find(ma => ma.id === s.module_id)?.nombre || 'MOD S/N');
        return { ...s, client_name: client.nombre_fiscal, item_display_name: itemName };
      }));
    } catch(e) { return Response.error(e.message); }
  },

  save: function(payload) {
    try {
      if(!payload.client_id) return Response.error("Cliente requerido.");
      if(!payload.id || payload.id === 'new') {
        payload.id = _DB.getNextSequentialId("SUBSCRIPTIONS", "SUB");
        payload.created_at = new Date().toISOString();
      }
      _DB.save("SUBSCRIPTIONS", payload.id, payload);
      return Response.success(payload);
    } catch(e) { return Response.error(e.message); }
  },

  delete: function(payload) {
    return _DB.moveToTrash("SUBSCRIPTIONS", payload.id) ? Response.success(null) : Response.error("DB Error");
  },

  getAutomationStatus: function() {
    const triggers = ScriptApp.getProjectTriggers();
    const active = triggers.some(t => t.getHandlerFunction() === 'runDailyBilling');
    const hour = _DB.getSetting("AUTO_BILLING_HOUR", 4);
    return Response.success({ active, hour });
  }
};