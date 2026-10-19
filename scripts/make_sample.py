"""Erzeugt ein verrauschtes Mess-STL eines Beispielteils (Ebenen, Bohrungen, Langloch, Zylinder, Kegel, Kugel, Torus).
Benötigt: pip install cadquery-ocp numpy  (nur Entwicklung, nicht zur Laufzeit)."""
import sys, struct, numpy as np
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeCone, BRepPrimAPI_MakeSphere, BRepPrimAPI_MakeTorus
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.gp import gp_Pnt, gp_Ax2, gp_Dir
from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs
from OCP.IGESControl import IGESControl_Writer
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
from OCP.TopoDS import TopoDS
from OCP.BRep import BRep_Tool
from OCP.TopLoc import TopLoc_Location
def st(c,n): return getattr(c,n+"_s",None) or getattr(c,n)
Z=gp_Dir(0,0,1)
def part(hole_d=12.0, boss_dx=0.0):
    s=BRepPrimAPI_MakeBox(100,60,20).Shape()
    def cyl(x,y,r,z0,h): return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x,y,z0),Z),r,h).Shape()
    s=BRepAlgoAPI_Cut(s,cyl(20,20,hole_d/2,-1,22)).Shape()
    s=BRepAlgoAPI_Cut(s,cyl(85,10,3,-1,22)).Shape()
    slot=BRepPrimAPI_MakeBox(gp_Pnt(10,40,-1),20,10,22).Shape()
    slot=BRepAlgoAPI_Fuse(slot,cyl(10,45,5,-1,22)).Shape()
    slot=BRepAlgoAPI_Fuse(slot,cyl(30,45,5,-1,22)).Shape()
    s=BRepAlgoAPI_Cut(s,slot).Shape()
    s=BRepAlgoAPI_Fuse(s,cyl(55+boss_dx,30,8,20,12)).Shape()
    s=BRepAlgoAPI_Fuse(s,BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(82,38,20),Z),10,4,10).Shape()).Shape()
    s=BRepAlgoAPI_Fuse(s,BRepPrimAPI_MakeSphere(gp_Pnt(60,8,17),7).Shape()).Shape()
    # Torusring (R=6, r=2), Mitte 0,8 mm über der Oberseite -> teilweise eingebettet, scharfe Kante zur Ebene
    s=BRepAlgoAPI_Fuse(s,BRepPrimAPI_MakeTorus(gp_Ax2(gp_Pnt(40,10,20.8),Z),6,2).Shape()).Shape()
    return s
def mesh(s,defl):
    BRepMesh_IncrementalMesh(s,defl,False,0.1,True)
    V=[];T=[];off=0
    e=TopExp_Explorer(s,TopAbs_FACE)
    while e.More():
        f=st(TopoDS,"Face")(e.Current()); loc=TopLoc_Location()
        p=st(BRep_Tool,"Triangulation")(f,loc); tr=loc.Transformation()
        for i in range(1,p.NbNodes()+1):
            q=p.Node(i).Transformed(tr); V.append((q.X(),q.Y(),q.Z()))
        for i in range(1,p.NbTriangles()+1):
            a,b,c=p.Triangle(i).Get(); t=(a-1+off,b-1+off,c-1+off)
            if f.Orientation()==TopAbs_REVERSED: t=(t[0],t[2],t[1])
            T.append(t)
        off+=p.NbNodes(); e.Next()
    return np.array(V),np.array(T)
def scanify(V,T,L,seed):
    """Wie ein professioneller Mesher: annähernd gleichseitige Dreiecke (isotropes Remeshing, Kantenlänge L),
    Messrauschen σ 8 µm entlang der Normalen, räumlich geglättet (1-Ring), kein Rauschen quer zur Fläche."""
    import pymeshlab
    rng=np.random.default_rng(seed)
    ms=pymeshlab.MeshSet(); ms.add_mesh(pymeshlab.Mesh(V,T))
    ms.meshing_merge_close_vertices(threshold=pymeshlab.PureValue(1e-4)); ms.meshing_remove_duplicate_faces(); ms.meshing_remove_null_faces()
    ms.meshing_surface_subdivision_midpoint(iterations=12,threshold=pymeshlab.PureValue(2*L))
    ms.meshing_isotropic_explicit_remeshing(targetlen=pymeshlab.PureValue(L),iterations=15,featuredeg=15,adaptive=False)
    m=ms.current_mesh(); V=m.vertex_matrix().copy(); T=m.face_matrix().copy(); N=m.vertex_normal_matrix().copy()
    N/=np.maximum(np.linalg.norm(N,axis=1,keepdims=True),1e-12)
    e=rng.normal(0,1,len(V)); E=np.concatenate([T[:,[0,1]],T[:,[1,2]],T[:,[2,0]]])
    s=np.zeros(len(V)); c=np.zeros(len(V)); np.add.at(s,E[:,0],e[E[:,1]]); np.add.at(c,E[:,0],1); np.add.at(s,E[:,1],e[E[:,0]]); np.add.at(c,E[:,1],1)
    e=0.5*e+0.5*s/np.maximum(c,1); e*=0.008/e.std()
    return V+N*e[:,None],T
def write_stl(path,tris):
    n=np.cross(tris[:,1]-tris[:,0],tris[:,2]-tris[:,0]); n/=np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-12)
    dt=np.dtype([("n","<f4",3),("v","<f4",(3,3)),("a","<u2")]); a=np.zeros(len(tris),dt); a["n"]=n; a["v"]=tris
    with open(path,"wb") as f: f.write(b"metrology sample".ljust(80,b" ")); f.write(struct.pack("<I",len(tris))); f.write(a.tobytes())
out=sys.argv[1] if len(sys.argv)>1 else "public/samples"
# Messteil: Bohrung D12.08 (Soll 12), Bolzen +0.05 in X. 0.36: isotropes Netz ~0,5 mm statt CAD-Splitter (Nadeldreiecke).
V,T=mesh(part(12.08,0.05),0.003)
V,T=scanify(V,T,0.5,1)
write_stl(f"{out}/beispielteil.stl",V[T].astype(np.float32))
print("ok",len(T))
