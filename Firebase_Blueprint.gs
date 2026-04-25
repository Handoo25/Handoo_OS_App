/**
 * Firebase_Blueprint.gs
 * Estructura de datos para Firestore.
 */
const FIREBASE_BLUEPRINT = {
  "entities": {
    "UnitConversion": {
      "title": "Unit Conversion",
      "description": "Rules for converting between buying units and consumption units.",
      "type": "object",
      "properties": {
        "buy_unit": { "type": "string", "description": "The unit used when purchasing (e.g., CAJA)" },
        "factor": { "type": "number", "description": "The multiplier (e.g., 6)" },
        "consume_unit": { "type": "string", "description": "The unit used when consuming (e.g., BOTELLA)" },
        "updatedAt": { "type": "string", "format": "date-time" }
      },
      "required": ["buy_unit", "factor", "consume_unit"]
    },
    "InventoryAdjustment": {
      "title": "Inventory Adjustment",
      "description": "Direct adjustments to stock levels.",
      "type": "object",
      "properties": {
        "producto_id": { "type": "string" },
        "cantidad": { "type": "number" },
        "tipo": { "type": "string", "enum": ["SUMA", "RESTA"] },
        "timestamp": { "type": "string", "format": "date-time" },
        "user_id": { "type": "string" }
      },
      "required": ["producto_id", "cantidad", "tipo", "timestamp", "user_id"]
    },
    "Vendor": {
      "title": "Vendor",
      "description": "Vendor logistics and identity data for real-time alerts.",
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "nombre_fiscal": { "type": "string" },
        "dia_limite_pedido": { "type": "string" },
        "hora_limite_pedido": { "type": "string" },
        "lead_time": { "type": "number" },
        "updated_at": { "type": "string", "format": "date-time" }
      },
      "required": ["id", "nombre_fiscal"]
    }
  },
  "firestore": {
    "/unit_conversions/{conversionId}": {
      "schema": "UnitConversion",
      "description": "Global unit conversion rules."
    },
    "/inventory_adjustments/{adjustmentId}": {
      "schema": "InventoryAdjustment",
      "description": "Log of inventory adjustments."
    },
    "/vendors/{vendorId}": {
      "schema": "Vendor",
      "description": "Vendor logistics data for predictive alerts."
    }
  }
};
