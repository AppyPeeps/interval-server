"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mockActionGroupAccess = exports.mockActionAccess = exports.mockUserAccessGroup = exports.mockActionGroupMetadata = exports.mockActionMetadata = exports.mockQueuedAction = exports.mockActionGroup = exports.mockAction = exports.mockTransaction = exports.mockUserOrganizationAccess = exports.mockEnvironment = exports.mockOrganization = exports.mockUser = void 0;
exports.mockUser = {
    id: '1',
    firstName: 'John',
    isGhostMode: false,
    lastName: 'Doe',
    email: 'john.doe@interval.com',
    mfaId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    defaultNotificationMethod: 'EMAIL',
    timeZoneName: null,
};
exports.mockOrganization = {
    id: '1',
    name: 'Interval',
    isGhostMode: false,
    slug: 'interval',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ownerId: exports.mockUser.id,
    promoCode: null,
    requireMfa: false,
};
exports.mockEnvironment = {
    id: '1',
    name: 'Production',
    slug: 'production',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    organizationId: '1',
    color: null,
};
exports.mockUserOrganizationAccess = {
    id: '1',
    organizationId: exports.mockOrganization.id,
    userId: exports.mockUser.id,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSwitchedToAt: new Date(),
    permissions: ['ADMIN'],
    slackOauthNonce: null,
    onboardingExampleSlug: null,
};
exports.mockTransaction = {
    id: '1',
    ownerId: exports.mockUser.id,
    actionId: '1',
    actionScheduleId: null,
    status: 'COMPLETED',
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    resultData: null,
    resultDataMeta: null,
    resultSchemaVersion: null,
    resultStatus: null,
    currentClientId: null,
    lastInputGroupKey: null,
    hostInstanceId: '1',
};
exports.mockAction = {
    id: '1',
    slug: 'update_user',
    organizationId: exports.mockOrganization.id,
    organizationEnvironmentId: exports.mockEnvironment.id,
    createdAt: new Date(),
    updatedAt: new Date(),
    developerId: null,
    isInline: false,
    name: null,
    description: null,
    backgroundable: null,
    warnOnClose: true,
    unlisted: false,
};
exports.mockActionGroup = {
    id: '1',
    slug: 'group',
    name: 'Group',
    description: null,
    hasHandler: false,
    unlisted: false,
    organizationId: exports.mockOrganization.id,
    organizationEnvironmentId: exports.mockEnvironment.id,
    createdAt: new Date(),
    updatedAt: new Date(),
    developerId: null,
};
exports.mockQueuedAction = {
    id: '1',
    actionId: '1',
    transactionId: '1',
    assigneeId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    params: { foo: 'bar' },
    paramsMeta: null,
};
exports.mockActionMetadata = {
    id: '1',
    actionId: '1',
    name: 'Update user',
    description: null,
    backgroundable: null,
    availability: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    defaultNotificationDelivery: null,
};
exports.mockActionGroupMetadata = {
    id: '1',
    actionGroupId: '1',
    availability: null,
    createdAt: new Date(),
    updatedAt: new Date(),
};
exports.mockUserAccessGroup = {
    id: '1',
    name: 'Support',
    slug: 'support',
    scimGroupId: null,
    organizationId: exports.mockOrganization.id,
    createdAt: new Date(),
    updatedAt: new Date(),
};
exports.mockActionAccess = {
    id: '1',
    actionMetadataId: '1',
    userAccessGroupId: '1',
    createdAt: new Date(),
    updatedAt: new Date(),
    level: 'RUNNER',
};
exports.mockActionGroupAccess = {
    id: '1',
    actionGroupMetadataId: '1',
    userAccessGroupId: '1',
    createdAt: new Date(),
    updatedAt: new Date(),
    level: 'RUNNER',
};
