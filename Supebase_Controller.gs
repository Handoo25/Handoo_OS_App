/**
 * MOTOR DE BASE DE DATOS PROFESIONAL - SUPABASE (MODO DIAGNÓSTICO)
 */

const RAW_URL = 'https://jbicjmjesfjwzagjeexs.supabase.co'; 
// 👇 PEGA TU CLAVE LARGA AQUÍ ABAJO 👇
const RAW_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpiaWNqbWplc2Zqd3phZ2plZXhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwODQ2NTgsImV4cCI6MjA5MjY2MDY1OH0.2tWhIwzIORErutmWrgTR6e8djeVNKpu5w5hk_UbVSc4'; 

// Limpieza extrema de seguridad
const SUPABASE = {
  URL: RAW_URL.trim().replace(/\/$/, ''), // Quita la barra final si se coló
  KEY: RAW_KEY.trim().replace(/\s+/g, '') 
};

var SupabaseDB = {
  get: function(table) {
    const endpoint = SUPABASE.URL + '/rest/v1/' + table + '?select=*';
    const options = {
      'method': 'get',
      'headers': {
        'apikey': SUPABASE.KEY,
        'Authorization': 'Bearer ' + SUPABASE.KEY,
        'Content-Type': 'application/json'
      },
      'muteHttpExceptions': true
    };
    
    Logger.log("-> INTENTANDO LEER DE: " + endpoint);
    const response = UrlFetchApp.fetch(endpoint, options);
    const code = response.getResponseCode();
    const text = response.getContentText();
    Logger.log("<- RESPUESTA LECTURA (Código " + code + "): " + text);
    
    if (code >= 200 && code < 300) {
      return text ? JSON.parse(text) : [];
    }
    return [];
  },

  upsert: function(table, data) {
    const endpoint = SUPABASE.URL + '/rest/v1/' + table;
    const payloadData = Array.isArray(data) ? data : [data]; 
    
    const options = {
      'method': 'post',
      'headers': {
        'apikey': SUPABASE.KEY,
        'Authorization': 'Bearer ' + SUPABASE.KEY,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      'payload': JSON.stringify(payloadData),
      'muteHttpExceptions': true
    };
    
    Logger.log("-> INTENTANDO GUARDAR EN: " + endpoint);
    const response = UrlFetchApp.fetch(endpoint, options);
    const code = response.getResponseCode();
    const text = response.getContentText();
    Logger.log("<- RESPUESTA GUARDADO (Código " + code + "): " + text);
    
    if (code >= 200 && code < 300) {
      return text ? JSON.parse(text) : null;
    }
    return null;
  }
};

function TEST_SUPABASE_CONNECTION() {
  var productoPrueba = {
    id: "TEST-001",
    nombre: "Hamburguesa Supabase Premium",
    tipo: "VENTA_FINAL",
    stock_actual: 50,
    coste: 3.50,
    pvp: 12.00
  };
  
  Logger.log("================ INICIANDO PRUEBA ================");
  var respuestaGuardado = SupabaseDB.upsert("masters", productoPrueba);
  
  Logger.log("--------------------------------------------------");
  var datosLeidos = SupabaseDB.get("masters");
  
  if(datosLeidos.length > 0) {
    Logger.log("¡CONEXIÓN EXITOSA! EL FERRARI ESTÁ RUGIENDO.");
  } else {
    Logger.log("ALGO HA FALLADO. MIRA LOS MENSAJES DE ARRIBA.");
  }
}
