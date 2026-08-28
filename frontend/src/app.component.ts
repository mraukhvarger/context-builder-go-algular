import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface FileNode {
  path: string;
  name: string;
  isDir: boolean;
  children?: FileNode[];
  checked?: boolean;
  expanded?: boolean;
}

declare global {
  interface Window {
    goGetInitialDir: () => Promise<string>;
    goSelectDirectory: (currentDir: string) => Promise<string>;
    goGetTree: (path: string) => Promise<string>;
    goGenerateContext: (rootDir: string, files: string[]) => Promise<string>;
    goSaveToFile: (text: string, currentDir: string) => Promise<boolean>;
  }
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="app-layout">
      <!-- Сайдбар -->
      <div class="sidebar">
        <div class="toolbar">
          <button (click)="selectFolder()">📁 Выбрать папку</button>
          <button (click)="refreshTree()">🔄 Обновить</button>
          <button (click)="toggleAll(true)">Развернуть</button>
          <button (click)="toggleAll(false)">Свернуть</button>
        </div>

        <div class="path-display" [title]="currentPath">
          📂 {{ currentPath || 'Папка не выбрана' }}
        </div>

        <div class="tree-container">
          <ng-template #treeTemplate let-nodes let-depth="depth">
            <div *ngFor="let node of nodes" class="tree-node">
              <div class="node-row" [style.padding-left.px]="depth * 14">
                <button 
                  *ngIf="node.isDir" 
                  type="button"
                  class="expand-btn" 
                  (click)="toggleNode(node, $event)">
                  {{ node.expanded ? '▼' : '▶' }}
                </button>
                <span *ngIf="!node.isDir" class="expand-spacer"></span>

                <input 
                  type="checkbox" 
                  [checked]="node.checked" 
                  (change)="onCheckboxChange(node, $event)" />

                <span class="node-label" (dblclick)="node.isDir && toggleNode(node, $event)">
                  {{ node.isDir ? '📁' : '📄' }} {{ node.name }}
                </span>
              </div>

              <div *ngIf="node.isDir && node.expanded && node.children?.length">
                <ng-container *ngTemplateOutlet="treeTemplate; context: { $implicit: node.children, depth: depth + 1 }"></ng-container>
              </div>
            </div>
          </ng-template>

          <ng-container *ngIf="rootNode">
            <ng-container *ngTemplateOutlet="treeTemplate; context: { $implicit: rootNode.children, depth: 0 }"></ng-container>
          </ng-container>
        </div>

        <div class="bottom-bar">
          <button class="btn-primary" (click)="generate()">⚡ Собрать контекст</button>
          <div class="status">{{ status }}</div>
        </div>
      </div>

      <!-- Главная панель -->
      <div class="main-view">
        <div class="actions">
          <button (click)="copy()" [disabled]="!resultText">{{ copyLabel }}</button>
          <button (click)="save()" [disabled]="!resultText">💾 Сохранить в файл</button>
        </div>
        <textarea class="editor" readonly [value]="resultText" placeholder="Здесь появится сформированный контекст..."></textarea>
      </div>
    </div>
  `,
  styles: [`
    .app-layout { display: flex; height: 100vh; overflow: hidden; }
    .sidebar { width: 380px; display: flex; flex-direction: column; background: #fff; border-right: 1px solid #e2e8f0; padding: 12px; }
    .toolbar { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px; }
    .path-display { font-size: 11px; color: #64748b; background: #f1f5f9; padding: 4px 6px; border-radius: 4px; margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: monospace; }
    button { padding: 6px 10px; border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 4px; cursor: pointer; font-size: 12px; }
    button:hover { background: #f1f5f9; }
    .tree-container { flex: 1; overflow: auto; border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px; background: #fafafa; }
    .node-row { display: flex; align-items: center; gap: 6px; padding: 2px 0; font-size: 13px; user-select: none; }
    .expand-btn { width: 20px; height: 20px; padding: 0; font-size: 10px; border: none; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #475569; }
    .expand-btn:hover { background: #e2e8f0; border-radius: 3px; }
    .expand-spacer { width: 20px; }
    .node-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: default; }
    .bottom-bar { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
    .btn-primary { background: #2563eb; color: #fff; border: none; font-weight: 500; }
    .btn-primary:hover { background: #1d4ed8; }
    .status { font-size: 12px; color: #64748b; }
    .main-view { flex: 1; display: flex; flex-direction: column; padding: 12px; background: #fff; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 8px; }
    .editor { flex: 1; font-family: 'Cascadia Code', Consolas, monospace; font-size: 13px; padding: 12px; border: 1px solid #cbd5e1; border-radius: 4px; resize: none; background: #0f172a; color: #f8fafc; }
  `]
})
export class AppComponent implements OnInit {
  private cdr = inject(ChangeDetectorRef);

  rootNode: FileNode | null = null;
  currentPath = '';
  resultText = '';
  status = '';
  copyLabel = '📋 Скопировать';

  async ngOnInit() {
    if (window.goGetInitialDir) {
      this.currentPath = await window.goGetInitialDir();
    }
    this.refreshTree();
  }

  toggleNode(node: FileNode, event?: Event) {
    if (event) event.stopPropagation();
    node.expanded = !node.expanded;
    this.cdr.detectChanges();
  }

  onCheckboxChange(node: FileNode, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.checkRecursive(node, checked);
    this.cdr.detectChanges();
  }

  async selectFolder() {
    if (window.goSelectDirectory) {
      const path = await window.goSelectDirectory(this.currentPath);
      if (path) {
        this.currentPath = path;
        this.refreshTree();
      }
    }
  }

  async refreshTree() {
    if (!window.goGetTree) return;
    try {
      const json = await window.goGetTree(this.currentPath);
      if (json) {
        const node: FileNode = JSON.parse(json);
        this.initTreeState(node, true);
        this.rootNode = node;
        this.cdr.detectChanges();
      }
    } catch (err) {
      console.error(err);
    }
  }

  initTreeState(n: FileNode, check: boolean) {
    n.checked = check;
    n.expanded = false;
    if (n.children) n.children.forEach(c => this.initTreeState(c, check));
  }

  checkRecursive(node: FileNode, check: boolean) {
    node.checked = check;
    if (node.children) {
      node.children.forEach(c => this.checkRecursive(c, check));
    }
  }

  toggleAll(expand: boolean) {
    const apply = (n: FileNode) => {
      n.expanded = expand;
      if (n.children) n.children.forEach(apply);
    };
    if (this.rootNode) apply(this.rootNode);
    this.cdr.detectChanges();
  }

  async generate() {
    if (!this.rootNode || !window.goGenerateContext) return;
    const files: string[] = [];
    const collect = (n: FileNode) => {
      if (!n.isDir && n.checked) files.push(n.path);
      if (n.children) n.children.forEach(collect);
    };
    collect(this.rootNode);

    this.status = 'Сборка...';
    this.cdr.detectChanges();

    const resRaw = await window.goGenerateContext(this.rootNode.path, files);
    const res = JSON.parse(resRaw);
    this.resultText = res.context;
    this.status = `Готово: ${res.count} файлов (${res.sizeMb.toFixed(2)} МБ)`;
    this.cdr.detectChanges();
  }

  async copy() {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(this.resultText);
      this.copyLabel = 'Скопировано! ✓';
      this.cdr.detectChanges();
      setTimeout(() => {
        this.copyLabel = '📋 Скопировать';
        this.cdr.detectChanges();
      }, 2000);
    }
  }

  async save() {
    if (window.goSaveToFile) {
      await window.goSaveToFile(this.resultText, this.currentPath);
    }
  }
}