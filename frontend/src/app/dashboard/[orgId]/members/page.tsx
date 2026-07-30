"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useOrg } from "@/context/org-context";
import { useAuth } from "@/context/auth-context";
import * as membersApi from "@/lib/api/members";
import * as invitationsApi from "@/lib/api/invitations";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import type { Invitation, Membership, MembershipRole } from "@/lib/api/types";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const roleLabels: Record<MembershipRole, string> = { OWNER: "Sahip", ADMIN: "Yönetici", MEMBER: "Üye" };
const roleTones: Record<MembershipRole, "primary" | "success" | "neutral"> = {
  OWNER: "primary",
  ADMIN: "success",
  MEMBER: "neutral",
};

export default function MembersPage() {
  const { organization, role } = useOrg();
  const { user } = useAuth();
  const canManage = role === "OWNER" || role === "ADMIN";

  const [members, setMembers] = useState<Membership[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);

  const load = useCallback(async () => {
    setListError(null);
    try {
      const [membersPage, invites] = await Promise.all([
        membersApi.listMembers(organization.id),
        canManage ? invitationsApi.listInvitations(organization.id) : Promise.resolve([]),
      ]);
      setMembers(membersPage.items);
      setInvitations(invites);
    } catch (err) {
      setListError(friendlyErrorMessage(err));
    }
  }, [organization.id, canManage]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    setInviteError(null);
    setInviteSuccess(false);
    setInviting(true);
    try {
      await invitationsApi.createInvitation(organization.id, { email: inviteEmail, role: inviteRole });
      setInviteEmail("");
      setInviteSuccess(true);
      await load();
    } catch (err) {
      setInviteError(friendlyErrorMessage(err));
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(userId: string, newRole: "ADMIN" | "MEMBER") {
    setBusyUserId(userId);
    setRowError(null);
    try {
      await membersApi.updateMemberRole(organization.id, userId, { role: newRole });
      await load();
    } catch (err) {
      setRowError(friendlyErrorMessage(err));
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleRemove(userId: string) {
    setBusyUserId(userId);
    setRowError(null);
    try {
      await membersApi.removeMember(organization.id, userId);
      await load();
    } catch (err) {
      setRowError(friendlyErrorMessage(err));
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div className="space-y-6">
      {listError && <Alert variant="error">{listError}</Alert>}
      {rowError && <Alert variant="error">{rowError}</Alert>}

      <Card>
        <h2 className="text-base font-semibold text-foreground">Üyeler</h2>

        {members === null ? (
          <div className="mt-6 flex justify-center">
            <Spinner className="h-5 w-5 text-primary" />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {members.map((member) => {
              const isOwner = member.role === "OWNER";
              const isSelf = member.userId === user?.id;
              return (
                <li key={member.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={member.user.name} src={member.user.avatarUrl} size={36} />
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {member.user.name} {isSelf && <span className="text-foreground/50">(siz)</span>}
                      </p>
                      <p className="text-xs text-foreground/60">{member.user.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {canManage && !isOwner ? (
                      <Select
                        aria-label={`${member.user.name} için rol`}
                        value={member.role}
                        disabled={busyUserId === member.userId}
                        onChange={(e) => handleRoleChange(member.userId, e.target.value as "ADMIN" | "MEMBER")}
                        className="w-auto"
                      >
                        <option value="ADMIN">Yönetici</option>
                        <option value="MEMBER">Üye</option>
                      </Select>
                    ) : (
                      <Badge tone={roleTones[member.role]}>{roleLabels[member.role]}</Badge>
                    )}

                    {canManage && !isOwner && (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busyUserId === member.userId}
                        onClick={() => handleRemove(member.userId)}
                      >
                        Çıkar
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}

            {members.length === 0 && (
              <li className="py-6 text-center text-sm text-foreground/60">Henüz üye yok.</li>
            )}
          </ul>
        )}
      </Card>

      {canManage && (
        <Card>
          <h2 className="text-base font-semibold text-foreground">Yeni üye davet et</h2>

          {inviteError && (
            <Alert variant="error" className="mt-4">
              {inviteError}
            </Alert>
          )}
          {inviteSuccess && (
            <Alert variant="success" className="mt-4">
              Davet gönderildi.
            </Alert>
          )}

          <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={handleInvite} noValidate>
            <div className="flex-1">
              <Field id="invite-email" label="E-posta" required>
                {(inputProps) => (
                  <Input
                    {...inputProps}
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <div>
              <Field id="invite-role" label="Rol">
                {(inputProps) => (
                  <Select
                    {...inputProps}
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as "ADMIN" | "MEMBER")}
                  >
                    <option value="MEMBER">Üye</option>
                    <option value="ADMIN">Yönetici</option>
                  </Select>
                )}
              </Field>
            </div>
            <Button type="submit" loading={inviting}>
              Davet gönder
            </Button>
          </form>

          {invitations.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-medium text-foreground/70">Bekleyen davetler</h3>
              <ul className="mt-2 space-y-2">
                {invitations.map((invite) => (
                  <li key={invite.id} className="flex items-center justify-between text-sm">
                    <span className="text-foreground/80">{invite.email}</span>
                    <Badge tone={roleTones[invite.role]}>{roleLabels[invite.role]}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
