function TITANIUM_AUTO_LINK_DRIVE_ICONS() {
  // 1. REEMPLAZA ESTO CON EL ID DE TU CARPETA DE DRIVE (el que sale en la URL)
  const FOLDER_ID = "1Kbli27-N78AW0kyjW5I6eL_XArzv11JY"; 
  const iconsFolder = DriveApp.getFolderById(FOLDER_ID);
  const files = iconsFolder.getFiles();
  const iconMap = {};

  console.log("Escaneando carpeta de Drive...");

  // 2. Mapeamos los archivos por nombre (mayúsculas) -> Link Directo Titanium
  while (files.hasNext()) {
    let file = files.next();
    // Quitamos la extensión (.png, .jpg) para comparar el nombre
    let fileNameNoExt = file.getName().replace(/\.[^/.]+$/, "").toUpperCase().trim();
    
    // Generamos el link directo de visualización para que el PDF y la App lo lean
    let directLink = "https://drive.google.com/uc?export=view&id=" + file.getId();
    iconMap[fileNameNoExt] = directLink;
    console.log("Encontrado: " + fileNameNoExt + " -> " + directLink);
  }

  // 3. Buscamos los alérgenos en el Excel y les asignamos el icono de Drive
  const masters = _DB.get("MASTERS") || [];
  const allergens = masters.filter(m => m.id && m.id.startsWith("ALG-"));
  let totalActualizados = 0;

  console.log("Iniciando vinculación en el Excel...");

  allergens.forEach(allergen => {
    let nombreLimpio = allergen.nombre.toUpperCase().trim();
    let driveLink = iconMap[nombreLimpio];

    // Si encontramos el archivo y el link es diferente, actualizamos
    if (driveLink && allergen.icon_url !== driveLink) {
      allergen.icon_url = driveLink;
      // Guardamos el JSON completo de nuevo en la Columna B
      _DB.save("MASTERS", allergen.id, allergen);
      totalActualizados++;
      console.log(">>> VINCULADO: " + allergen.nombre);
    }
  });

  console.log("✅ OPERACIÓN FINALIZADA. Se han actualizado " + totalActualizados + " iconos usando Google Drive.");
}
