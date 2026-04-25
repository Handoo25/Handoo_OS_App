/**
 * EJECUTAR UNA SOLA VEZ: Crea y rellena la pestaña GEO_DATA con los municipios de España.
 * Mantiene el Kernel ligero cargando los datos directamente en el Spreadsheet.
 */
function TITANIUM_hydrate_geo_data() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("GEO_DATA");
  
  if (!sheet) {
    sheet = ss.insertSheet("GEO_DATA");
  } else {
    sheet.clear();
  }

  // Encabezados obligatorios para el controlador v188.0
  sheet.getRange(1, 1, 1, 2).setValues([["PROVINCIA", "MUNICIPIO"]]);
  
  // URL de un recurso JSON ligero con los municipios de España
  // Usamos una fuente externa fiable para no saturar tu código
  try {
    const response = UrlFetchApp.fetch("https://raw.githubusercontent.com/frontid/comunidades-provincias-municipios/master/municipios.json");
    const data = JSON.parse(response.getContentText());
    
    // Transformamos los datos al formato Titanium (Provincia | Municipio)
    // Nota: Esta fuente requiere mapear el ID de provincia al nombre
    const provinciasMap = {
      "01":"ALAVA","02":"ALBACETE","03":"ALICANTE","04":"ALMERIA","05":"AVILA","06":"BADAJOZ","07":"BALEARS","08":"BARCELONA","09":"BURGOS","10":"CACERES",
      "11":"CADIZ","12":"CASTELLON","13":"CIUDAD REAL","14":"CORDOBA","15":"A CORUÑA","16":"CUENCA","17":"GIRONA","18":"GRANADA","19":"GUADALAJARA","20":"GUIPUZCOA",
      "21":"HUELVA","22":"HUESCA","23":"JAEN","24":"LEON","25":"LLEIDA","26":"LA RIOJA","27":"LUGO","28":"MADRID","29":"MALAGA","30":"MURCIA",
      "31":"NAVARRA","32":"OURENSE","33":"ASTURIAS","34":"PALENCIA","35":"LAS PALMAS","36":"PONTEVEDRA","37":"SALAMANCA","38":"SANTA CRUZ DE TENERIFE","39":"CANTABRIA","40":"SEGOVIA",
      "41":"SEVILLA","42":"SORIA","43":"TARRAGONA","44":"TERUEL","45":"TOLEDO","46":"VALENCIA","47":"VALLADOLID","48":"BIZKAIA","49":"ZAMORA","50":"ZARAGOZA","51":"CEUTA","52":"MELILLA"
    };

    const rows = data.map(m => {
      const provName = provinciasMap[m.provincia_id] || "DESCONOCIDA";
      return [provName, m.nombre.toUpperCase()];
    });

    // Inyección atómica en el Spreadsheet
    sheet.getRange(2, 1, rows.length, 2).setValues(rows);
    sheet.sort(1); // Ordenar por provincia
    
    return "Sincronización completada: " + rows.length + " municipios cargados.";
  } catch (e) {
    return "Error en la hidratación: " + e.message;
  }
}
