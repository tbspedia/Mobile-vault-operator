// Simulate Obsidian Mobile environment (Android WebView)
import fs from 'fs';
import vm from 'vm';

console.log('Simulating Obsidian Mobile environment against built main.js...');

const moduleObj = { exports: {} };

class MockComponent {
    load() {}
    onload() {}
    unload() {}
    onunload() {}
    addChild(c) { return c; }
    removeChild(c) {}
    register(cb) {}
    registerEvent(e) {}
    registerInterval(i) {}
}

class MockView extends MockComponent {
    app;
    leaf;
    containerEl = { addEventListener: () => {}, querySelector: () => null, createEl: () => ({ addEventListener: () => {} }) };
    constructor(leaf) { super(); this.leaf = leaf; }
    getViewType() { return ''; }
    getDisplayText() { return ''; }
}

class MockItemView extends MockView {
    contentEl = { addEventListener: () => {}, querySelector: () => null, createEl: () => ({ addEventListener: () => {} }) };
}

const baseObsidian = {
    Plugin: class extends MockComponent {
        app;
        manifest;
        constructor(app, manifest) {
            super();
            this.app = app;
            this.manifest = manifest;
        }
        addRibbonIcon() { return { addClass: () => {} }; }
        addCommand() {}
        addSettingTab() {}
        registerView() {}
        loadData() { return Promise.resolve({}); }
        saveData() { return Promise.resolve(); }
    },
    Component: MockComponent,
    View: MockView,
    ItemView: MockItemView,
    Modal: class extends MockComponent {
        app;
        contentEl = { createEl: () => ({}) };
        constructor(app) { super(); this.app = app; }
        open() {}
        close() {}
    },
    Setting: class {
        settingEl = { addClass: () => {}, createDiv: () => ({}) };
        setName() { return this; }
        setDesc() { return this; }
        addText() { return this; }
        addToggle() { return this; }
        addButton() { return this; }
        addDropdown() { return this; }
    },
    PluginSettingTab: class {
        app;
        plugin;
        containerEl = { empty: () => {}, createEl: () => ({}) };
        constructor(app, plugin) { this.app = app; this.plugin = plugin; }
        display() {}
        hide() {}
    },
    Platform: { isDesktopApp: false, isMobile: true, isIos: false, isAndroidApp: true },
    normalizePath: (p) => (p || '').replace(/\\/g, '/'),
    Notice: class {},
    TFile: class {},
    TFolder: class {},
    TAbstractFile: class {},
    setIcon: () => {},
    addIcon: () => {},
    requestUrl: async () => ({ status: 200, json: async () => ({}) })
};

const mockObsidian = new Proxy(baseObsidian, {
    get(target, prop) {
        if (prop in target) return target[prop];
        const FallbackClass = class {
            constructor() {}
        };
        return FallbackClass;
    }
});

const mockApp = {
    vault: {
        adapter: {
            exists: async () => false,
            read: async () => '',
            write: async () => {},
            mkdir: async () => {},
            rename: async () => {},
            list: async () => ({ files: [], folders: [] })
        },
        configDir: '.obsidian',
        getAbstractFileByPath: () => null,
        getRoot: () => ({ children: [] }),
        getMarkdownFiles: () => [],
        on: () => {}
    },
    workspace: {
        on: () => {},
        getLeavesOfType: () => [],
        getRightLeaf: () => null,
        revealLeaf: () => {},
        onLayoutReady: (cb) => setTimeout(cb, 0)
    },
    metadataCache: {
        on: () => {},
        getFileCache: () => null
    }
};

const sandbox = {
    window: {},
    document: {
        createElement: () => ({ addEventListener: () => {}, setAttribute: () => {}, style: {}, appendChild: () => {} }),
        body: { appendChild: () => {}, createEl: () => ({ addEventListener: () => {} }) },
        head: { appendChild: () => {} }
    },
    module: moduleObj,
    exports: moduleObj.exports,
    navigator: { userAgent: 'Android' },
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    TextEncoder: TextEncoder,
    TextDecoder: TextDecoder,
    ReadableStream: ReadableStream,
    WritableStream: WritableStream,
    TransformStream: TransformStream,
    Headers: Headers,
    Request: Request,
    Response: Response,
    fetch: fetch,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    require: (moduleName) => {
        if (moduleName === 'obsidian') {
            return mockObsidian;
        }
        if (moduleName.startsWith('@codemirror/') || moduleName.startsWith('@lezer/')) {
            return new Proxy({}, {
                get: () => class {}
            });
        }
        // Real Obsidian Mobile require() returns undefined for unknown modules instead of throwing
        return undefined;
    }
};

sandbox.window = sandbox;
sandbox.global = sandbox;
sandbox.globalThis = sandbox;

const code = fs.readFileSync('main.js', 'utf8');

try {
    const script = new vm.Script(code, { filename: 'main.js' });
    const context = vm.createContext(sandbox);
    script.runInContext(context);
    console.log('SUCCESS! main.js evaluated completely without crashing in mobile environment.');
    const PluginClass = sandbox.module.exports?.default;
    console.log('Plugin class name:', PluginClass?.name);
    
    // Simulate plugin instance creation
    const pluginInstance = new PluginClass(mockApp, { id: 'vault-operator', version: '1.0.0' });
    console.log('Plugin instance instantiated successfully on mobile!');
    process.exit(0);
} catch (err) {
    console.error('CRASH ON SCRIPT LOAD:');
    console.error(err);
    process.exit(1);
}
