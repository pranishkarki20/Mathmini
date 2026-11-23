from django.conf import settings
from rest_framework.permissions import BasePermission, SAFE_METHODS

class OperatorWritePermission(BasePermission):
    """Allow anonymous mutation only in explicitly enabled DEBUG demo mode."""
    message = 'Only an authenticated administrator or traffic operator can change operational data.'
    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        user = request.user
        if user and user.is_authenticated and (user.is_staff or user.groups.filter(name__in=['Administrator', 'Traffic operator']).exists()):
            return True
        return settings.ALLOW_DEMO_WRITES
