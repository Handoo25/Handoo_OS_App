/**
 * Module_Subscription.gs - TITANIUM RECURRENCE ENGINE V2.0 (STRIPE INTEGRATED)
 */
var Module_Subscription = {

  /**
   * Calcula la próxima fecha de cobro basada en el ciclo.
   */
  calculateNextBillingDate: function(baseDate, cycle) {
    let date = new Date(baseDate);
    if(cycle === 'Mensual') date.setMonth(date.getMonth() + 1);
    else if(cycle === 'Trimestral') date.setMonth(date.getMonth() + 3);
    else if(cycle === 'Anual') date.setFullYear(date.getFullYear() + 1);
    return date.toISOString().split('T')[0];
  },

  /**
   * Proceso masivo con integración de pasarela de pago
   */
  runBillingRobot: function() {
    const today = new Date(); today.setHours(0,0,0,0);
    const subs = _DB.get("SUBSCRIPTIONS") || [];
    const clients = _DB.get("tenants") || [];
    let counter = 0;

    subs.filter(s => s.status === 'Activo' && s.next_billing && new Date(s.next_billing) <= today).forEach(s => {
      const client = clients.find(c => c.id === s.client_id);
      if (!client) return;

      const baseRaw = parseFloat(s.price || 0);
      const discPerc = parseFloat(client.facturacion?.descuento || 0);
      const base = baseRaw * (1 - discPerc / 100);
      
      const ivaPerc = parseFloat(client.facturacion?.tipo_impuesto_valor || 21);
      const ivaAmount = base * (ivaPerc / 100);
      const total = base + ivaAmount;
      
      const concept = s.item_display_name || 'CUOTA RECURRENTE';

      let autoPaid = false;

      // INTENTO DE COBRO AUTOMÁTICO VÍA STRIPE
      if (client.stripe_customer_id && client.stripe_autopay && client.facturacion?.forma_pago === 'STRIPE') {
        try {
          const charge = Stripe_Controller.executeCharge(client.id, total, `RENOVACIÓN ${concept} - ${s.id}`);
          if (charge.status === 'succeeded') {
            autoPaid = true;
          }
        } catch(e) {
          console.error(`Fallo cobro Stripe SUB ${s.id}: ${e.message}`);
          Module_Treasury.lockClientForDefault(client.id, `SUB-${s.id}-FAILED-STRIPE`);
          return; // No generar factura si el autopay falla para evitar descuadres
        }
      }

      const draftId = (autoPaid ? "FAC-STRIPE-" : "DFT-ROBOT-") + Date.now() + "-" + s.id;
      
      const invoice = {
        id: draftId,
        subscription_origin_id: s.id,
        client_id: client.id,
        client_name: client.nombre_fiscal,
        item_display_name: concept,
        base: base,
        total_iva: ivaAmount,
        total: total,
        status: autoPaid ? 'ISSUED' : 'DRAFT',
        fecha: new Date().toISOString().split('T')[0],
        created_by: 'ROBOT',
        payment_method_real: autoPaid ? 'STRIPE' : null,
        is_autopaid: autoPaid
      };

      _DB.save("DB_INVOICES", invoice.id, invoice);

      // Si se cobró automáticamente, generar efecto liquidado
      if (autoPaid) {
        const effectId = _DB.getNextSequentialId("DB_TREASURY_EFFECTS", "EFE-STR");
        _DB.save("DB_TREASURY_EFFECTS", effectId, {
          id: effectId, invoice_id: invoice.id, client_id: client.id, client_name: client.nombre_fiscal,
          importe: total, vencimiento: invoice.fecha, status: 'COBRADO', metodo: 'STRIPE',
          fecha_cobro_real: new Date().toISOString(), canal_pago: 'STRIPE CLOUD'
        });
      }

      s.next_billing = this.calculateNextBillingDate(s.next_billing, s.cycle);
      _DB.save("SUBSCRIPTIONS", s.id, s);
      counter++;
    });

    Admin_Controller.updatePGCSaldos();
    return counter;
  }
};