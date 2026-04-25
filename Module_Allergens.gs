/**
 * MÓDULO INDEPENDIENTE: GESTIÓN DE ALÉRGENOS (APPCC)
 * Tabla base: DB_ALLERGENS
 */
var Allergens_Controller = {

  getList: function() {
    try {
      const allergens = _DB.get('DB_ALLERGENS') || [];
      return Response.success(allergens);
    } catch(e) { 
      return Response.error("Error al obtener alérgenos: " + e.message); 
    }
  },

  save: function(payload) {
    if (!payload || !payload.id) return { ok: false, msg: "ID faltante" };

    // 1. Buscamos en la tabla CORRECTA (DB_ALLERGENS)
    const existingAllergen = _DB.get("DB_ALLERGENS", payload.id); 
    
    // 2. Creamos el objeto limpio
    const newAllergen = {
        id: payload.id,
        nombre: payload.nombre,
        icon_url: payload.icon_url
    };
    
    // 3. Borramos el viejo si existía
    if (existingAllergen) {
        _DB.delete("DB_ALLERGENS", payload.id);
    }
    
    // 4. Guardamos en la tabla CORRECTA
    _DB.save("DB_ALLERGENS", payload.id, newAllergen);
    
    return { ok: true, data: newAllergen };
  },

  delete: function(payload) {
    try {
      if (!payload.id) return Response.error("ID de alérgeno no proporcionado.");
      
      _DB.delete('DB_ALLERGENS', payload.id);
      SpreadsheetApp.flush();
      
      return Response.success(null, "Alérgeno eliminado correctamente.");
    } catch(e) { 
      return Response.error("Error al eliminar alérgeno: " + e.message); 
    }
  },

  generate_pdf: function(payload) {
    try {
      const masters = _DB.get("MASTERS") || [];
      
      // 1. Buscamos la ficha de empresa que tiene el check de 'favorita' (tu sede principal)
      const company = masters.find(m => m.id && m.id.startsWith("MST-COMPANY") && m.favorita === true) || {};
      
      // 2. Obtenemos el catálogo organizado
      const catalogObj = Module_Inventory.getCatalog();
      const allItems = [...catalogObj.products, ...catalogObj.modules, ...catalogObj.plans];

      // 3. Generamos el PDF
      const html = HtmlService.createTemplateFromFile('Template_Allergens');
      html.items = allItems;
      html.companyName = company.nombre || "Mi Empresa";
      html.companyLogo = company.logo_url || company.logo || "";
      
      const blob = html.evaluate().getAs('application/pdf');
      
      let folder;
      const folders = DriveApp.getFoldersByName("HANDOO_ALLERGENS");
      if (folders.hasNext()) folder = folders.next();
      else folder = DriveApp.createFolder("HANDOO_ALLERGENS");

      const name = `CARTA_ALERGENOS_${company.nombre || 'EMPRESA'}_${new Date().toISOString().split('T')[0]}.pdf`;
      const file = folder.createFile(blob).setName(name);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      
      return Response.success({ url: file.getUrl() });
    } catch(e) { 
      return Response.error("Error al generar PDF de alérgenos: " + e.message); 
    }
  },

  upload_icon_to_drive: function(payload) {
    try {
      const FOLDER_ID = "1Kbli27-N78AW0kyjW5I6eL_XArzv11JY"; 
      const folder = DriveApp.getFolderById(FOLDER_ID);
      
      // 1. Convertimos el base64 en un archivo real de Drive
      const blob = Utilities.newBlob(Utilities.base64Decode(payload.base64), payload.mimeType, payload.fileName);
      const file = folder.createFile(blob);
      
      // 2. Le damos permisos de lectura públicos
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      
      // --- EL TRUCO TITANIUM AQUÍ ---
      // Generamos el link directo Y le añadimos un sello de tiempo único (&t=123...)
      // Esto evita que el navegador use la caché antigua.
      const timestamp = new Date().getTime();
      const directLink = "https://drive.google.com/uc?export=view&id=" + file.getId() + "&t=" + timestamp;
      // ------------------------------

      // 3. Actualizamos el Excel al momento
      if (payload.allergenId) {
        const allergen = _DB.get("DB_ALLERGENS", payload.allergenId);
        if (allergen) {
          allergen.icon_url = directLink;
          _DB.save("DB_ALLERGENS", payload.allergenId, allergen);
        }
      }

      return { ok: true, url: directLink };
    } catch (e) {
      return { ok: false, msg: e.message };
    }
  },

  /**
   * FASE 1: Función para obtener todas las imágenes existentes en tu carpeta de Drive.
   */
  api_get_drive_images: function() {
    const FOLDER_ID = "1Kbli27-N78AW0kyjW5I6eL_XArzv11JY"; // Tu carpeta ya configurada
    try {
      const folder = DriveApp.getFolderById(FOLDER_ID);
      const files = folder.getFiles();
      const images = [];

      while (files.hasNext()) {
        let file = files.next();
        // Solo aceptamos imágenes
        if (file.getMimeType().startsWith("image/")) {
          // --- EL NUEVO TRUCO DE URL ROBUSTA ---
          // Usamos lh3.googleusercontent.com que es mucho más estable para previsualizaciones
          const robustLink = "https://lh3.googleusercontent.com/u/0/d/" + file.getId();
          
          images.push({
            id: file.getId(),
            name: file.getName(),
            url: robustLink // Esta URL NO debería salir en blanco en la App
          });
        }
      }
      return { ok: true, data: images };
    } catch (e) {
      return { ok: false, msg: e.message };
    }
  }
};
