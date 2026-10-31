/**
 * Translations (English and European Portuguese) shared by the extension and the Android app.
 * English is the source of truth: a missing Portuguese key falls back to English (a test keeps
 * both dictionaries in step).
 */
export type Lang = 'en' | 'pt';
export type LangSetting = 'system' | Lang;

export const en = {
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.back': 'Back',
  'common.working': 'Working…',
  'common.language': 'Language',
  'common.openWindow': 'Open in a window to choose a file',
  'lang.system': 'System',

  'nav.vault': 'Vault',
  'nav.codes': 'Codes',
  'nav.generate': 'Generate',
  'nav.settings': 'Settings',

  'auth.createTitle': 'Create your vault',
  'auth.signInTitle': 'Sign in',
  'auth.tagline': 'Zero-knowledge: your master password never leaves this device.',
  'auth.email': 'Email',
  'auth.masterPassword': 'Master password',
  'auth.confirmPassword': 'Confirm master password',
  'auth.createAccount': 'Create account',
  'auth.signIn': 'Sign in',
  'auth.haveAccount': 'I already have an account',
  'auth.newAccount': 'Create a new account',
  'auth.restore': 'Restore from a backup file',
  'auth.unlock': 'Unlock',
  'auth.lockedTitle': 'Vault locked',
  'auth.enterPin': 'Enter your 6-digit PIN',
  'auth.usePassword': 'Use master password',
  'auth.usePin': 'Use PIN',
  'auth.useBiometrics': 'Use biometrics',

  'settings.title': 'Settings',
  'settings.account': 'Account',
  'settings.security': 'Security',
  'settings.autofill': 'Autofill & passkeys',
  'settings.health': 'Password health',
  'settings.import': 'Import',
  'settings.backup': 'Backup',
  'settings.appearance': 'Appearance',
  'settings.devices': 'Devices',
  'settings.signedInAs': 'Signed in as',
  'settings.server': 'Server',
  'settings.syncNow': 'Sync now',
  'settings.autoLock': 'Auto-lock',
  'settings.clipboard': 'Clear clipboard',
  'settings.lockNow': 'Lock now',
  'settings.signOut': 'Sign out',
  'settings.theme': 'Theme',
  'settings.revoke': 'Revoke',

  'health.intro':
    'Checks your logins on this device for weak, reused and old passwords. Nothing leaves your device.',
  'health.scan': 'Scan my vault',
  'health.score': 'Health score',
  'health.weak': 'Weak passwords',
  'health.reused': 'Reused passwords',
  'health.old': 'Not changed in over a year',
  'health.breached': 'Found in data breaches',
  'health.allGood': 'Nothing to fix here.',
  'health.checkBreaches': 'Check for breaches',
  'health.breachInfo':
    'Sends only the first 5 characters of each password’s SHA-1 hash to Have I Been Pwned (k-anonymity); your passwords never leave this device.',
  'health.checking': 'Checking…',
  'health.breachFailed': 'Could not reach the breach service.',
  'health.times': 'seen {n} times',

  'import.intro': 'Bring logins from another password manager.',
  'import.source': 'Import from',
  'import.chooseFile': 'Choose file',
  'import.found': '{n} items found',
  'import.skipped': '{n} skipped',
  'import.run': 'Import {n} items',
  'import.done': 'Imported {n} items',
  'import.warning':
    'Exports are not encrypted. Delete the file after importing and empty your trash.',
  'import.bad': 'That file does not look like an export from {source}.',
  'import.encrypted': 'Encrypted exports are not supported. Export an unencrypted file.',

  'backup.connect': 'Connect Google Drive',
  'backup.now': 'Back up now',
  'backup.disconnect': 'Disconnect',
  'backup.daily': 'Daily backups',
  'backup.export': 'Download encrypted backup file',
  'backup.lastBackup': 'Last backup',
  'backup.never': 'never',
} as const;

export type MessageKey = keyof typeof en;

export const pt: Record<MessageKey, string> = {
  'common.cancel': 'Cancelar',
  'common.close': 'Fechar',
  'common.back': 'Voltar',
  'common.working': 'A processar…',
  'common.language': 'Idioma',
  'common.openWindow': 'Abrir numa janela para escolher um ficheiro',
  'lang.system': 'Sistema',

  'nav.vault': 'Cofre',
  'nav.codes': 'Códigos',
  'nav.generate': 'Gerar',
  'nav.settings': 'Definições',

  'auth.createTitle': 'Crie o seu cofre',
  'auth.signInTitle': 'Iniciar sessão',
  'auth.tagline': 'Zero conhecimento: a sua palavra-passe mestra nunca sai deste dispositivo.',
  'auth.email': 'Email',
  'auth.masterPassword': 'Palavra-passe mestra',
  'auth.confirmPassword': 'Confirmar palavra-passe mestra',
  'auth.createAccount': 'Criar conta',
  'auth.signIn': 'Iniciar sessão',
  'auth.haveAccount': 'Já tenho conta',
  'auth.newAccount': 'Criar uma conta nova',
  'auth.restore': 'Restaurar a partir de uma cópia de segurança',
  'auth.unlock': 'Desbloquear',
  'auth.lockedTitle': 'Cofre bloqueado',
  'auth.enterPin': 'Introduza o seu PIN de 6 dígitos',
  'auth.usePassword': 'Usar palavra-passe mestra',
  'auth.usePin': 'Usar PIN',
  'auth.useBiometrics': 'Usar biometria',

  'settings.title': 'Definições',
  'settings.account': 'Conta',
  'settings.security': 'Segurança',
  'settings.autofill': 'Preenchimento e passkeys',
  'settings.health': 'Saúde das palavras-passe',
  'settings.import': 'Importar',
  'settings.backup': 'Cópia de segurança',
  'settings.appearance': 'Aspeto',
  'settings.devices': 'Dispositivos',
  'settings.signedInAs': 'Sessão iniciada como',
  'settings.server': 'Servidor',
  'settings.syncNow': 'Sincronizar agora',
  'settings.autoLock': 'Bloqueio automático',
  'settings.clipboard': 'Limpar área de transferência',
  'settings.lockNow': 'Bloquear agora',
  'settings.signOut': 'Terminar sessão',
  'settings.theme': 'Tema',
  'settings.revoke': 'Revogar',

  'health.intro':
    'Verifica neste dispositivo se há palavras-passe fracas, repetidas ou antigas. Nada sai do seu dispositivo.',
  'health.scan': 'Analisar o meu cofre',
  'health.score': 'Pontuação de saúde',
  'health.weak': 'Palavras-passe fracas',
  'health.reused': 'Palavras-passe repetidas',
  'health.old': 'Sem alteração há mais de um ano',
  'health.breached': 'Encontradas em fugas de dados',
  'health.allGood': 'Nada a corrigir aqui.',
  'health.checkBreaches': 'Verificar fugas de dados',
  'health.breachInfo':
    'Envia apenas os primeiros 5 caracteres do hash SHA-1 de cada palavra-passe ao Have I Been Pwned (k-anonimato); as suas palavras-passe nunca saem deste dispositivo.',
  'health.checking': 'A verificar…',
  'health.breachFailed': 'Não foi possível contactar o serviço de fugas de dados.',
  'health.times': 'vista {n} vezes',

  'import.intro': 'Traga logins de outro gestor de palavras-passe.',
  'import.source': 'Importar de',
  'import.chooseFile': 'Escolher ficheiro',
  'import.found': '{n} itens encontrados',
  'import.skipped': '{n} ignorados',
  'import.run': 'Importar {n} itens',
  'import.done': '{n} itens importados',
  'import.warning':
    'As exportações não estão cifradas. Apague o ficheiro depois de importar e esvazie o lixo.',
  'import.bad': 'Este ficheiro não parece ser uma exportação de {source}.',
  'import.encrypted': 'As exportações cifradas não são suportadas. Exporte um ficheiro sem cifra.',

  'backup.connect': 'Ligar o Google Drive',
  'backup.now': 'Fazer cópia agora',
  'backup.disconnect': 'Desligar',
  'backup.daily': 'Cópias diárias',
  'backup.export': 'Transferir ficheiro de cópia cifrado',
  'backup.lastBackup': 'Última cópia',
  'backup.never': 'nunca',
};

/** `system` follows the device language; anything that is not Portuguese is English. */
export function resolveLang(setting: LangSetting, systemLocale: string | undefined): Lang {
  if (setting !== 'system') return setting;
  return systemLocale?.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function createT(lang: Lang): Translate {
  const dict: Record<MessageKey, string> = lang === 'pt' ? pt : en;
  return (key, vars) => {
    const text = dict[key] ?? en[key];
    return vars ? text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : text;
  };
}
