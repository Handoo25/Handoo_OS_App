/**
 * Firebase_Rules.gs
 * Reglas de seguridad para Firestore.
 */
const FIRESTORE_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    function isAuthenticated() {
      return request.auth != null;
    }

    function isAdmin() {
      return isAuthenticated() && 
        (request.auth.token.email == "admin@handoo.app" && request.auth.token.email_verified == true);
    }

    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }

    match /unit_conversions/{conversionId} {
      allow read: if isAuthenticated();
      allow write: if isAdmin();
    }

    match /inventory_adjustments/{adjustmentId} {
      allow read: if isAuthenticated() && (isAdmin() || request.auth.uid == resource.data.user_id);
      allow create: if isAuthenticated() && request.resource.data.user_id == request.auth.uid;
      allow update, delete: if isAdmin();
    }

    match /vendors/{vendorId} {
      allow read: if isAuthenticated();
      allow write: if isAdmin();
    }
  }
}
`;
