"""Erzeugt ein verrauschtes Mess-STL eines Beispielteils (Ebenen, Bohrungen, Langloch, Zylinder, Kegel, Kugel).
Benötigt: pip install cadquery-ocp numpy  (nur Entwicklung, nicht zur Laufzeit)."""
import sys, struct, numpy as np
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeCone, BRepPrimAPI_MakeSphere
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
def subdivide(V,T,maxlen):
    tris=V[T]; out=[]
    stack=list(tris)
    while stack:
        t=stack.pop(); L=[np.linalg.norm(t[1]-t[0]),np.linalg.norm(t[2]-t[1]),np.linalg.norm(t[0]-t[2])]
        k=int(np.argmax(L))
        if L[k]<=maxlen: out.append(t); continue
        a,b,c=t[k],t[(k+1)%3],t[(k+2)%3]; m=(a+b)/2
        stack.append(np.array([a,m,c])); stack.append(np.array([m,b,c]))
    return np.array(out)
def write_stl(path,tris):
    n=np.cross(tris[:,1]-tris[:,0],tris[:,2]-tris[:,0]); n/=np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-12)
    dt=np.dtype([("n","<f4",3),("v","<f4",(3,3)),("a","<u2")]); a=np.zeros(len(tris),dt); a["n"]=n; a["v"]=tris
    with open(path,"wb") as f: f.write(b"metrology sample".ljust(80,b" ")); f.write(struct.pack("<I",len(tris))); f.write(a.tobytes())
out=sys.argv[1] if len(sys.argv)>1 else "public/samples"
# Messteil: Bohrung D12.08 (Soll 12), Bolzen +0.05 in X
V,T=mesh(part(12.08,0.05),0.005)
tris=subdivide(V,T,1.8)
rng=np.random.default_rng(1)
P=tris.reshape(-1,3); key=np.round(P*1e5).astype(np.int64)
u,inv=np.unique(key,axis=0,return_inverse=True); noise=rng.normal(0,0.008,(len(u),3))
P=P+noise[inv.ravel()]
write_stl(f"{out}/beispielteil.stl",P.reshape(-1,3,3))
print("ok",len(tris))
