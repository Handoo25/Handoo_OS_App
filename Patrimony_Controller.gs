/**
 * Patrimony_Controller.gs - TITANIUM V1.2
 * Gestión de Activos Fijos (Cta. 21X) y Utillaje Operativo (Cta. 214).
 * Incluye motor de amortización en tiempo real y gestión de bajas.
 */
var Patrimony_Controller = {

  // --- GESTIÓN DE REGLAS DE AMORTIZACIÓN (INMOVILIZADO) ---

  listAmortizationRules: function() {
    try {
      let rules = _DB.get("DB_AMORTIZATION_RULES") || [];
      if (rules.length === 0) {
        // Pre-poblado de reglas estándar PGC
        const defaults = [
          { id: 'RULE_IT', name: 'Equipos Informáticos', years: 4, percentage: 25, min_years: 8, max_percentage: 50, residual_percent: 0 },
          { id: 'RULE_MOB', name: 'Mobiliario y Enseres', years: 10, percentage: 10, min_years: 20, max_percentage: 20, residual_percent: 5 },
          { id: 'RULE_MAQ', name: 'Maquinaria', years: 8, percentage: 12.5, min_years: 18, max_percentage: 25, residual_percent: 10 },
          { id: 'RULE_TRA', name: 'Elementos de Transporte', years: 6, percentage: 16, min_years: 14, max_percentage: 32, residual_percent: 15 },
          { id: 'RULE_EDI', name: 'Edificios y Construcciones', years: 33, percentage: 3, min_years: 100, max_percentage: 6, residual_percent: 20 }
        ];
        defaults.forEach(r => _DB.save("DB_AMORTIZATION_RULES", r.id, r));
        rules = defaults;
      }
      return Response.success(rules);
    } catch (e) {
      return Response.error(e.message);
    }
  },

  saveAmortizationRule: function(payload) {
    try {
      if (!payload.id || payload.id === 'new') {
        payload.id = "RULE_" + payload.name.toUpperCase().replace(/\s+/g, '_');
      }
      // Aseguramos valores numéricos para los cálculos
      payload.residual_percent = parseFloat(payload.residual_percent || 0);
      payload.percentage = parseFloat(payload.percentage || 0);
      payload.years = parseInt(payload.years || 0);

      _DB.save("DB_AMORTIZATION_RULES", payload.id, payload);
      return Response.success(payload, "Regla de amortización guardada");
    } catch (e) {
      return Response.error(e.message);
    }
  },

  deleteAmortizationRule: function(payload) {
    try {
      _DB.delete("DB_AMORTIZATION_RULES", payload.id);
      return Response.success(null, "Regla eliminada");
    } catch (e) {
      return Response.error(e.message);
    }
  },

  // --- GESTIÓN DE CATEGORÍAS DE UTILLAJE (INDEPENDIENTES) ---

  listToolCategories: function() {
    try {
      let categories = _DB.get("DB_TOOL_CATEGORIES") || [];
      if (categories.length === 0) {
        const defaults = [
          { id: 'CAT_MENAJE', name: 'MENAJE / CRISTALERÍA' },
          { id: 'CAT_MAQUINARIA', name: 'MAQUINARIA LIGERA' },
          { id: 'CAT_HERRAMIENTA', name: 'HERRAMIENTAS MANUALES' },
          { id: 'CAT_EPIS', name: 'EPIS / SEGURIDAD' }
        ];
        defaults.forEach(c => _DB.save("DB_TOOL_CATEGORIES", c.id, c));
        categories = defaults;
      }
      return Response.success(categories);
    } catch (e) {
      return Response.error(e.message);
    }
  },

  saveToolCategory: function(payload) {
    try {
      if (!payload.id || payload.id === 'new') {
        payload.id = "CAT_" + payload.name.toUpperCase().replace(/\s+/g, '_');
      }
      _DB.save("DB_TOOL_CATEGORIES", payload.id, payload);
      return Response.success(payload, "Categoría de utillaje guardada");
    } catch (e) {
      return Response.error(e.message);
    }
  },

  deleteToolCategory: function(payload) {
    try {
      _DB.delete("DB_TOOL_CATEGORIES", payload.id);
      return Response.success(null, "Categoría eliminada");
    } catch (e) {
      return Response.error(e.message);
    }
  },

  // --- GESTIÓN DE INMOVILIZADO ---

  listFixedAssets: function() {
    try {
      const assets = _DB.get("DB_FIXED_ASSETS") || [];
      return Response.success(assets);
    } catch (e) {
      return Response.error(e.message);
    }
  },

  saveFixedAsset: function(payload) {
    try {
      if (!payload.nombre || payload.coste_adquisicion === undefined) {
        throw new Error("Datos obligatorios incompletos");
      }
      
      if (!payload.id || payload.id === 'new') {
        payload.id = _DB.getNextSequentialId("DB_FIXED_ASSETS", "ACT");
        payload.created_at = new Date().toISOString();
      }

      // BLINDAJE CONTABLE TITANIUM: Lógica de Estado y Resultados
      if (payload.estado === 'BAJA') {
        // En caso de baja por siniestro/rotura, el precio de venta es cero
        payload.precio_venta = 0;
        // Calculamos el Valor Neto Contable actual para registrar la pérdida total
        const vncActual = this._calculateCurrentVNC(payload);
        payload.resultado_enajenacion = vncActual * -1; // Pérdida total
      } else if (payload.estado === 'VENDIDO') {
        // Si se vende, el resultado es Precio Venta - Valor Neto Contable
        const vncActual = this._calculateCurrentVNC(payload);
        payload.resultado_enajenacion = parseFloat(payload.precio_venta || 0) - vncActual;
      } else {
        // Si está Operativo, no hay resultado de enajenación
        payload.resultado_enajenacion = 0;
        payload.precio_venta = 0;
      }

      // Actualizamos valores calculados para el registro en DB
      payload.amortizacion_acumulada = this._calculateAccumulatedAmortization(payload);
      payload.valor_neto = parseFloat(payload.coste_adquisicion) - payload.amortizacion_acumulada;

      _DB.save("DB_FIXED_ASSETS", payload.id, payload);
      return Response.success(payload, "Activo sincronizado correctamente");
    } catch (e) {
      return Response.error(e.message);
    }
  },

  createAsset: function(payload) {
    return this.saveFixedAsset(payload);
  },

  deleteFixedAsset: function(payload) {
    try {
      _DB.delete("DB_FIXED_ASSETS", payload.id);
      return Response.success(null, "Activo eliminado");
    } catch (e) {
      return Response.error(e.message);
    }
  },

  // Función auxiliar para calcular el VNC en el momento de la transacción
  _calculateCurrentVNC: function(asset) {
    const amortizado = this._calculateAccumulatedAmortization(asset);
    return parseFloat(asset.coste_adquisicion) - amortizado;
  },

  _calculateAccumulatedAmortization: function(asset) {
    if (!asset.fecha_compra || asset.fecha_compra === "") return 0;
    
    // Determinamos vida útil real según modo
    let lifeMonths = parseInt(asset.vida_util_meses || 0);
    if (lifeMonths <= 0) return 0;

    let annualRate = (100 / (lifeMonths / 12)) / 100;

    // Si hay una regla técnica vinculada
    if (asset.rule_id) {
      const rules = _DB.get("DB_AMORTIZATION_RULES") || [];
      const rule = rules.find(r => r.id === asset.rule_id);
      if (rule) {
        if (asset.amortization_mode === 'ACCELERATED') {
          annualRate = (rule.max_percentage || (rule.percentage * 2)) / 100;
        } else if (asset.amortization_mode === 'MINIMUM') {
          const maxYears = rule.min_years || (rule.years * 2);
          annualRate = (100 / maxYears) / 100;
        } else {
          annualRate = (rule.percentage || (100 / rule.years)) / 100;
        }
      }
    }

    const start = new Date(asset.fecha_compra).getTime();
    const now = new Date().getTime();
    const diffMs = now - start;
    
    if (diffMs <= 0) return 0;
    
    const totalCost = parseFloat(asset.coste_adquisicion);
    const residualValue = parseFloat(asset.valor_residual || 0);
    const amortizableBase = totalCost - residualValue;
    
    // Motor de precisión Titanium: Amortización por milisegundo
    const msInYear = 365.25 * 24 * 60 * 60 * 1000;
    const msRate = annualRate / msInYear;
    
    const accumulated = Math.min(amortizableBase, diffMs * msRate * amortizableBase);
    
    return Math.round(accumulated * 100) / 100;
  },

  // --- GESTIÓN DE UTILLAJE (CUENTA 214) ---

  listOperationalTools: function() {
    try {
      const tools = _DB.get("DB_OPERATIONAL_TOOLS") || [];
      return Response.success(tools);
    } catch (e) {
      return Response.error(e.message);
    }
  },

  saveOperationalTool: function(payload) {
    try {
      if (!payload.nombre) throw new Error("Nombre requerido");
      
      if (!payload.id || payload.id === 'new') {
        payload.id = _DB.getNextSequentialId("DB_OPERATIONAL_TOOLS", "TL");
        payload.created_at = new Date().toISOString();
      }

      // Aseguramos integridad de tipos numéricos para stock
      payload.stock_actual = parseInt(payload.stock_actual || 0);
      payload.stock_saludable = parseInt(payload.stock_saludable || 0);
      payload.coste_unitario = parseFloat(payload.coste_unitario || 0);
      payload.movimientos = payload.movimientos || [];

      _DB.save("DB_OPERATIONAL_TOOLS", payload.id, payload);
      return Response.success(payload, "Herramienta/Utillaje guardado correctamente");
    } catch (e) {
      return Response.error(e.message);
    }
  },

  deleteOperationalTool: function(payload) {
    try {
      _DB.delete("DB_OPERATIONAL_TOOLS", payload.id);
      return Response.success(null, "Registro eliminado");
    } catch (e) {
      return Response.error(e.message);
    }
  }
};