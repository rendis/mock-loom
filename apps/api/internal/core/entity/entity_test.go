package entity

import "testing"

func TestWorkspaceRoleHasPermission(t *testing.T) {
	if !WorkspaceRoleOwner.HasPermission(WorkspaceRoleAdmin) {
		t.Fatal("owner should have admin permission")
	}
	if WorkspaceRoleViewer.HasPermission(WorkspaceRoleEditor) {
		t.Fatal("viewer should not have editor permission")
	}
	if !WorkspaceRoleAdmin.HasPermission(WorkspaceRoleViewer) {
		t.Fatal("admin should have viewer permission")
	}
}
