/** Minimal DOM host for real ReactDOM lifecycle tests. Not a browser/native simulator. */
export class PhotoTestNode {
  nodeType = 1;
  nodeName: string;
  tagName: string;
  namespaceURI = "http://www.w3.org/1999/xhtml";
  parentNode: PhotoTestNode | null = null;
  childNodes: PhotoTestNode[] = [];
  ownerDocument: PhotoTestDocument;
  attributes: Record<string, string> = {};
  style = {
    setProperty: (_name: string, _value: unknown) => {},
    removeProperty: (_name: string) => {},
  };
  private text = "";
  constructor(name: string, doc: PhotoTestDocument) {
    this.nodeName = name.toUpperCase();
    this.tagName = this.nodeName;
    this.ownerDocument = doc;
  }
  get firstChild(): PhotoTestNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): PhotoTestNode | null {
    return this.childNodes.at(-1) ?? null;
  }
  get nextSibling(): PhotoTestNode | null {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index + 1] ?? null;
  }
  get textContent(): string {
    return this.text + this.childNodes.map((node) => node.textContent).join("");
  }
  set textContent(value: string) {
    this.childNodes.forEach((child) => {
      child.parentNode = null;
    });
    this.childNodes = [];
    this.text = String(value ?? "");
  }
  get nodeValue() {
    return this.text;
  }
  set nodeValue(value: string) {
    this.text = value;
  }
  appendChild(node: PhotoTestNode) {
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  insertBefore(node: PhotoTestNode, before: PhotoTestNode) {
    node.parentNode?.removeChild(node);
    const index = this.childNodes.indexOf(before);
    node.parentNode = this;
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, node);
    return node;
  }
  removeChild(node: PhotoTestNode) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = String(value);
  }
  removeAttribute(name: string) {
    delete this.attributes[name];
  }
  setAttributeNS(_ns: string, name: string, value: string) {
    this.setAttribute(name, value);
  }
  removeAttributeNS(_ns: string, name: string) {
    this.removeAttribute(name);
  }
  addEventListener() {}
  removeEventListener() {}
  contains(node: PhotoTestNode): boolean {
    return (
      node === this || this.childNodes.some((child) => child.contains(node))
    );
  }
}
export class PhotoTestDocument {
  nodeType = 9;
  nodeName = "#document";
  documentElement = new PhotoTestNode("html", this);
  body = new PhotoTestNode("body", this);
  activeElement = this.body;
  defaultView: unknown;
  constructor() {
    this.documentElement.appendChild(this.body);
  }
  createElement(name: string) {
    return new PhotoTestNode(name, this);
  }
  createElementNS(_ns: string, name: string) {
    return this.createElement(name);
  }
  createTextNode(value: string) {
    const node = new PhotoTestNode("#text", this);
    node.nodeType = 3;
    node.nodeValue = value;
    return node;
  }
  addEventListener() {}
  removeEventListener() {}
}
export function installPhotoTestDOM() {
  const document = new PhotoTestDocument();
  const window = {
    document,
    HTMLElement: PhotoTestNode,
    HTMLIFrameElement: class {},
    addEventListener() {},
    removeEventListener() {},
  };
  document.defaultView = window;
  Object.assign(globalThis, {
    document,
    window,
    Node: PhotoTestNode,
    HTMLElement: PhotoTestNode,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  return document;
}
