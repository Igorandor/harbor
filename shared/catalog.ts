export type Entity = {
  id: string;
  title: string;
  singular: string;
  description: string;
  list: string;
  detail?: string;
  key: string;
  param?: string;
  columns: string[];
  fields?: string[];
  defaults?: Record<string, unknown>;
  createMethod?: 'PUT' | 'POST';
  privilege: string;
  readonly?: boolean;
  noDetail?: boolean;
};

export const entities: Record<string, Entity> = {
  apps: {
    id: 'apps',
    title: 'Web applications',
    singular: 'web application',
    description: 'Manage routes, authentication and the namespaces behind your applications.',
    list: '/v2/web-apps',
    detail: '/v2/web-app',
    key: 'Name',
    param: 'name',
    columns: ['Name', 'Namespace', 'Enabled', 'DispatchClass', 'AuthenticationMethods'],
    fields: ['NameSpace', 'Description', 'DispatchClass', 'Enabled', 'AutheEnabled', 'Resource'],
    defaults: { NameSpace: 'USER', Enabled: true, AutheEnabled: 32 },
    privilege: 'Secure',
  },

  users: {
    id: 'users',
    title: 'Users',
    singular: 'user',
    description: 'Manage accounts and the roles that give people access to IRIS.',
    list: '/v2/security/users',
    detail: '/v2/security/user',
    key: 'Name',
    param: 'name',
    columns: ['Name', 'FullName', 'Enabled', 'Type'],
    fields: ['FullName', 'Enabled', 'Roles', 'EmailAddress', 'Comment', 'ChangePassword'],
    defaults: { Enabled: true, ChangePassword: true, Roles: [] },
    createMethod: 'POST',
    privilege: 'Secure',
  },

  roles: {
    id: 'roles',
    title: 'Roles',
    singular: 'role',
    description: 'Build explicit resource grants and inspect inherited roles.',
    list: '/v2/security/roles',
    detail: '/v2/security/role',
    key: 'Name',
    param: 'name',
    columns: ['Name', 'Description', 'CreatedBy', 'EscalationOnly'],
    fields: ['Description', 'GrantedRoles', 'Resources', 'EscalationOnly'],
    defaults: { Description: '', Resources: [], GrantedRoles: [] },
    privilege: 'Secure',
  },

  resources: {
    id: 'resources',
    title: 'Resources',
    singular: 'resource',
    description: 'Define the security resources used by applications and role grants.',
    list: '/v2/security/resources',
    detail: '/v2/security/resource',
    key: 'Name',
    param: 'name',
    columns: ['Name', 'Description', 'PublicPermission'],
    fields: ['Description', 'PublicPermission'],
    defaults: { Description: '' },
    privilege: 'Secure',
  },

  collections: {
    id: 'collections',
    title: 'Wallet collections',
    singular: 'collection',
    description: 'Separate secrets by purpose and control who may edit and use them.',
    list: '/v2/wallet/collections',
    detail: '/v2/wallet/collection',
    key: 'Name',
    param: 'name',
    columns: ['Name', 'EditResource', 'UseResource'],
    fields: ['EditResource', 'UseResource'],
    defaults: { EditResource: '%Admin_Wallet:USE', UseResource: '%Admin_Wallet:USE' },
    privilege: 'Wallet',
  },

  secrets: {
    id: 'secrets',
    title: 'Wallet secrets',
    singular: 'secret',
    description: 'Create or rotate secrets. Stored secret values are never retrieved.',
    list: '/v2/wallet/secrets',
    detail: '/v2/wallet/secret',
    key: 'Name',
    param: 'name',
    columns: ['Name', 'Type'],
    fields: ['Type', 'WalletSecretConfig'],
    defaults: {
      Type: '%Wallet.KeyValue',
      WalletSecretConfig: { AllowedHosts: [], RequireTLS: true, Usage: ['HTTP'], Secret: {} },
    },
    noDetail: true,
    privilege: 'Wallet',
  },

  certificates: {
    id: 'certificates',
    title: 'X.509 credentials',
    singular: 'credential',
    description:
      'Register certificates already present on the IRIS server and restrict their owners.',
    list: '/v2/security/x509-credentials',
    detail: '/v2/security/x509-credential',
    key: 'Alias',
    param: 'alias',
    columns: ['Alias', 'HasPrivateKey', 'OwnerList', 'PeerNames'],
    fields: ['OwnerList', 'PeerNames', 'CAFile'],
    createMethod: 'POST',
    defaults: { OwnerList: [], PeerNames: [] },
    privilege: 'Secure',
  },

  tls: {
    id: 'tls',
    title: 'TLS configurations',
    singular: 'TLS configuration',
    description: 'Configure transport security for outbound and inbound connections.',
    list: '/v2/security/ssl-configurations',
    detail: '/v2/security/ssl-configuration',
    key: 'Name',
    param: 'name',
    columns: ['Name', 'Enabled', 'Description', 'Type'],
    fields: [
      'Description',
      'Enabled',
      'Type',
      'CAFile',
      'CertificateFile',
      'PrivateKeyFile',
      'VerifyPeer',
    ],
    defaults: { Enabled: true, Type: 0, VerifyPeer: 1, CAFile: '%OSCertificateStore' },
    privilege: 'Secure',
  },

  oauthServers: {
    id: 'oauthServers',
    title: 'OAuth server definitions',
    singular: 'OAuth server definition',
    description: 'Define the authorization servers trusted by your IRIS clients.',
    list: '/v2/security/oauth2/client/server-definitions',
    detail: '/v2/security/oauth2/client/server-definition',
    key: 'ID',
    param: 'serverId',
    columns: ['IssuerEndpoint', 'ClientCount', 'ResourceCount'],
    fields: ['IssuerEndpoint', 'SSLConfiguration', 'Metadata'],
    createMethod: 'POST',
    defaults: {},
    privilege: 'OAuth2_Client',
  },

  oauthClients: {
    id: 'oauthClients',
    title: 'OAuth client configurations',
    singular: 'OAuth client',
    description: 'Connect applications to an authorization server and configure their flow.',
    list: '/v2/security/oauth2/client/client-configurations',
    detail: '/v2/security/oauth2/client/client-configuration',
    key: 'ApplicationName',
    param: 'applicationName',
    columns: ['ApplicationName', 'ClientType', 'DefaultScope'],
    fields: [
      'OAuth2ServerDefinition',
      'Enabled',
      'Description',
      'ClientType',
      'SSLConfiguration',
      'RedirectionEndpoint',
      'DefaultScope',
    ],
    defaults: {
      Enabled: false,
      ClientType: 'confidential',
      SSLConfiguration: '',
      RedirectionEndpoint: '',
      DefaultScope: 'openid',
    },
    privilege: 'OAuth2_Client',
  },

  tasks: {
    id: 'tasks',
    title: 'Scheduled tasks',
    singular: 'task',
    description: 'Inspect schedules, run work on demand, and pause or resume individual tasks.',
    list: '/v2/tasks',
    detail: '/v2/task',
    key: 'Id',
    param: 'id',
    columns: ['Name', 'Namespace', 'Type', 'NextScheduled', 'LastFinished'],
    fields: [
      'Name',
      'Description',
      'NameSpace',
      'TaskClass',
      'StartDate',
      'DailyStartTime',
      'TimePeriod',
      'TimePeriodEvery',
    ],
    defaults: { NameSpace: '%SYS', TimePeriod: 'On Demand' },
    createMethod: 'POST',
    privilege: 'Task',
  },

  processes: {
    id: 'processes',
    title: 'Processes',
    singular: 'process',
    description: 'Inspect running jobs and control eligible processes.',
    list: '/v2/processes',
    detail: '/v2/process',
    key: 'Pid',
    param: 'id',
    columns: ['Pid', 'Username', 'Nspace', 'Routine', 'State', 'CPUTime'],
    privilege: 'Operate',
    readonly: true,
  },

  devices: {
    id: 'devices',
    title: 'Devices',
    singular: 'device',
    description: 'Configure device definitions and their physical targets.',
    list: '/v2/devices',
    detail: '/v2/device',
    key: 'Name',
    param: 'name',
    columns: ['Name', 'Type', 'Description', 'PhysicalDevice'],
    fields: ['PhysicalDevice', 'Type', 'SubType', 'Description'],
    defaults: { Type: 'OTH', SubType: 'M/UX' },
    privilege: 'Manage',
  },

  databases: {
    id: 'databases',
    title: 'Databases',
    singular: 'database',
    description: 'Inspect storage configuration without changing database files.',
    list: '/v2/databases',
    detail: '/v2/database',
    key: 'Name',
    param: 'name',
    columns: ['Name', 'Directory', 'Status', 'MountAtStartup'],
    privilege: 'Manage',
    readonly: true,
  },
};

export const labels: Record<string, string> = {
  NameSpace: 'Namespace',
  Nspace: 'Namespace',
  AutheEnabled: 'Authentication methods',
  DispatchClass: 'REST dispatch class',
  GrantedRoles: 'Inherited roles',
  Resources: 'Resource grants',
  OwnerList: 'Allowed users',
  CAFile: 'CA certificate file',
  SSLConfiguration: 'TLS configuration',
  WalletSecretConfig: 'Secret configuration',
  CPUTime: 'CPU time',
  NextScheduled: 'Next run',
  LastFinished: 'Last completed',
  Pid: 'Process ID',
  PublicPermission: 'Public permissions',
  Suspended: 'Schedule',
  Enabled: 'Status',
};

export const label = (key: string) => labels[key] ?? key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
