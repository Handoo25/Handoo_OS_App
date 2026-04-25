/**
 * Config.gs - TITANIUM ERP METADATA & GLOBAL CONFIGURATION
 * Este archivo centraliza la información que antes estaba en package.json y metadata.json
 */

var CONFIG = {
  APP_NAME: "HANDOO OS - TITANIUM V108",
  VERSION: "1.0.8",
  DESCRIPTION: "Sistema Operativo Financiero para Gestión de Tesorería, Facturación y Licencias Modulares.",
  AUTHOR: "Handoo App",
  
  // Permisos requeridos (Referencia para el usuario)
  PERMISSIONS: ["camera", "microphone", "geolocation"],
  
  // Ajustes de Interfaz
  UI: {
    BRAND_COLOR: "#f59e0b",
    DARK_COLOR: "#0f172a",
    DEFAULT_FISCAL_YEAR: new Date().getFullYear()
  }
};
