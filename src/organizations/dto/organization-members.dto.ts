// backend/api/src/organizations/dto/organization-members.dto.ts
import { OrganizationRole } from '@prisma/client';

export class AddMemberDto {
    currentUserId: string;      // хто додає (має бути OWNER)
    userId: string;             // кого додаємо
    role?: OrganizationRole;    // опціонально, за замовчуванням MEMBER
}

export class UpdateMemberRoleDto {
    currentUserId: string;      // хто змінює роль
    role: OrganizationRole;     // нова роль (OWNER / MEMBER)
}
