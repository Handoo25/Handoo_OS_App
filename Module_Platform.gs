/**
 * Module_Platform.gs - TITANIUM CORE BUSINESS LOGIC
 * Gestión de Reglas de Negocio para Clientes y Entidades.
 */
var Module_Platform = {

  /**
   * Calcula el desglose técnico de riesgos de un cliente basado en el balance actual.
   */
  getClientRiskBreakdown: function(client) {
    if (!client || !client.cuenta_contable) return { c430: 0, c431: 0, c4315: 0, total: 0 };
    
    const settings = Admin_Controller.getSettings().data;
    const balances = settings.balances || {};
    
    const acc430 = client.cuenta_contable;
    const acc431 = acc430.replace('430', '431');
    const acc4315 = acc430.replace('430', '4315');
    
    const r = {
      c430: parseFloat(balances[acc430] || 0),
      c431: parseFloat(balances[acc431] || 0),
      c4315: parseFloat(balances[acc4315] || 0)
    };
    
    r.total = r.c430 + r.c431 + r.c4315;
    return r;
  },

  /**
   * Verifica si el cliente tiene bloqueos de seguridad activos.
   */
  isClientRestricted: function(clientId) {
    const client = _DB.get("tenants").find(c => String(c.id) === String(clientId));
    return client ? (client.bloqueado_impago === true || client.estado === 'Suspensión') : false;
  },

  /**
   * Comprueba dependencias antes de permitir operaciones destructivas.
   */
  checkIntegrity: function(clientId) {
    const subs = _DB.get("SUBSCRIPTIONS") || [];
    const invs = _DB.get("DB_INVOICES") || [];
    const effects = _DB.get("DB_TREASURY_EFFECTS") || [];

    const deps = {
      subs: subs.filter(s => String(s.client_id) === String(clientId)).length,
      invs: invs.filter(i => String(i.client_id) === String(clientId)).length,
      effects: effects.filter(e => String(e.client_id) === String(clientId) && e.status !== 'COBRADO').length
    };

    return {
      safe: (deps.subs + deps.invs + deps.effects) === 0,
      details: deps
    };
  }
};