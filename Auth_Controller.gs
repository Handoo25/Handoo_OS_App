/**
 * Auth_Controller.gs - SECURITY SHIELD V60.2
 */
var Auth_Controller = {
  login: function(p) {
    if (!p || !p.pin) return Response.error("Credenciales no proporcionadas");
    
    // Obtenemos el PIN del motor atómico de ajustes
    const savedPin = _DB.getSetting("ADMIN_PIN", "1234");
    
    // Validación estricta de tipo cadena para evitar bypass
    if (String(p.pin).trim() === String(savedPin).trim()) {
      console.log("Acceso Autorizado: " + new Date().toISOString());
      return Response.success({ 
        session: true,
        role: "SUPERADMIN",
        env: "TITANIUM_V60_PRODUCTION"
      }, "Terminal Conectada");
    }
    
    console.warn("Intento de acceso fallido con PIN: " + p.pin);
    return Response.error("PIN de Acceso Incorrecto");
  }
};
