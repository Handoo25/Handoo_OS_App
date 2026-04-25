/**
 * Stripe_Controller.gs - TITANIUM V1.0 (STRIPE CONNECT)
 */
var Stripe_Controller = {
  
  saveConfig: function(payload) {
    try {
      if(payload.secret_key) _DB.save("SETTINGS_V70", "STRIPE_SECRET_KEY", payload.secret_key);
      if(payload.public_key) _DB.save("SETTINGS_V70", "STRIPE_PUBLIC_KEY", payload.public_key);
      return Response.success(null, "Configuración de Stripe sincronizada.");
    } catch(e) { return Response.error(e.message); }
  },

  syncCustomer: function(payload) {
    try {
      const client = _DB.get("tenants").find(c => c.id === payload.clientId);
      if(!client) return Response.error("Cliente no localizado.");
      
      client.stripe_customer_id = payload.stripeId;
      client.stripe_autopay = payload.autoPay;
      
      _DB.save("tenants", client.id, client);
      return Response.success(client, "Perfil de pago Stripe actualizado.");
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * Ejecuta un cobro directo contra Stripe
   */
  executeCharge: function(clientId, amount, description) {
    const secret = _DB.getSetting("STRIPE_SECRET_KEY");
    const client = _DB.get("tenants").find(c => c.id === clientId);
    
    if(!secret) throw new Error("Stripe no configurado en el Kernel.");
    if(!client.stripe_customer_id) throw new Error("Cliente sin vinculación Stripe.");

    const url = "https://api.stripe.com/v1/payment_intents";
    const payload = {
      amount: Math.round(amount * 100), // Stripe usa céntimos
      currency: "eur",
      customer: client.stripe_customer_id,
      description: description,
      confirm: "true",
      off_session: "true",
      payment_method_types: ["card"]
    };

    const options = {
      method: "post",
      headers: { "Authorization": "Bearer " + secret },
      payload: payload,
      muteHttpExceptions: true
    };

    const res = UrlFetchApp.fetch(url, options);
    const data = JSON.parse(res.getContentText());

    if(res.getResponseCode() !== 200) {
      throw new Error("Stripe API Error: " + (data.error ? data.error.message : "Fallo desconocido"));
    }

    return data;
  }
};