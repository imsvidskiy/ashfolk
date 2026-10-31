import { type Group, InstancedBufferGeometry, Mesh } from "three/webgpu";

export function drawnMeshes(group: Group, attribute: string): Mesh<InstancedBufferGeometry>[] {
  return group.children.filter((child): child is Mesh<InstancedBufferGeometry> => {
    return (
      child instanceof Mesh &&
      child.geometry instanceof InstancedBufferGeometry &&
      child.visible &&
      child.geometry.instanceCount > 0 &&
      child.geometry.getAttribute(attribute) !== undefined
    );
  });
}

export function drawnInstances(group: Group, attribute: string): number {
  return drawnMeshes(group, attribute).reduce((total, mesh) => {
    return total + mesh.geometry.instanceCount;
  }, 0);
}
