/**
 * Team_Controller.gs - GESTIÓN DE EQUIPO Y RRHH HANDOO
 */

var Team_Controller = {
  
  /**
   * Obtiene todos los trabajadores registrados.
   */
  list: function() {
    try {
      const staff = _DB.get("DB_TEAM") || [];
      return Response.success(staff);
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * Guarda o actualiza un trabajador.
   */
  save: function(payload) {
    try {
      if(!payload.name) throw new Error("El nombre es obligatorio");
      if(!payload.pin) throw new Error("El PIN es obligatorio");
      
      if(!payload.id) {
          payload.id = "STF_" + Date.now();
      }
      
      _DB.save("DB_TEAM", payload.id, payload);
      Admin_Controller._logAction("TEAM_SAVE", `Guardada ficha de ${payload.name} (${payload.role})`);
      return Response.success(payload, "Ficha guardada");
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * Da de baja a un trabajador.
   */
  delete: function(payload) {
    try {
      if(!payload.id) throw new Error("ID requerido");
      const staff = _DB.get("DB_TEAM") || [];
      const index = staff.findIndex(s => s.id === payload.id);
      if(index >= 0) {
          staff[index].active = false;
          _DB.save("DB_TEAM", payload.id, staff[index]);
          Admin_Controller._logAction("TEAM_DELETE", `Baja procesada para trabajador ID: ${payload.id}`);
          return Response.success(null, "Baja procesada correctamente");
      }
      throw new Error("Trabajador no encontrado");
    } catch(e) { return Response.error(e.message); }
  },

  /**
   * Elimina permanentemente a un trabajador de la base de datos.
   */
  purge: function(payload) {
    try {
      if(!payload.id) throw new Error("ID requerido");
      const ok = _DB.delete("DB_TEAM", payload.id);
      if(ok) {
          Admin_Controller._logAction("TEAM_PURGE", `Eliminación permanente de trabajador ID: ${payload.id}`);
          return Response.success(null, "Registro purgado correctamente");
      }
      throw new Error("Fallo al purgar registro");
    } catch(e) { return Response.error(e.message); }
  },
  
  /**
   * Verifica un PIN y devuelve el trabajador si es correcto.
   */
  verifyPIN: function(pin) {
      try {
          const staff = _DB.get("DB_TEAM") || [];
          const employee = staff.find(s => s.pin === pin && s.active);
          if(employee) return Response.success(employee);
          return Response.error("PIN incorrecto");
      } catch(e) { return Response.error(e.message); }
  },

  /**
   * Registra el consumo de un trabajador en el portal de autoconsumo.
   */
  register_consumption: function(payload) {
    try {
      const { staff_id, producto_id, cantidad, tipo } = payload;
      
      const staffArray = _DB.get("DB_TEAM") || [];
      const employee = staffArray.find(s => s.id === staff_id);
      const userName = employee ? employee.name : 'Desconocido';

      // Reutilizamos el motor de mermas para el descuento de stock
      const wastePayload = {
        producto_id: producto_id,
        cantidad: cantidad,
        tipo: tipo || 'STAFF_CONSUMPTION',
        motivo: 'AUTOCONSUMO PERSONAL',
        usuario: userName
      };
      
      return Inventory_Controller.register_waste_classified(wastePayload);
    } catch(e) { return Response.error(e.message); }
  }
};
