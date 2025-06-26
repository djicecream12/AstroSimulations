import numpy as np
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D
from matplotlib import animation
import matplotlib.patches as mpatches

fig = plt.figure()
ax = fig.add_subplot(111, projection='3d')
ax.set_facecolor('black')
fig.patch.set_facecolor('black')
ax.set_xlim([-10, 10])
ax.set_ylim([-10, 10])
ax.set_zlim([-10, 10])
ax.set_title("Space Debris Cleanup in Different Orbits", color='white', fontsize=14, pad=20)
ax.tick_params(colors='white')

RADIUS_EARTH = 1
u, v = np.mgrid[0:2 * np.pi:40j, 0:np.pi:20j]
x = RADIUS_EARTH * np.cos(u) * np.sin(v)
y = RADIUS_EARTH * np.sin(u) * np.sin(v)
z = RADIUS_EARTH * np.cos(v)
ax.plot_surface(x, y, z, color='blue', alpha=0.6)

def plot_torus(ax, R, r, color, alpha):
    u = np.linspace(0, 2 * np.pi, 60)
    v = np.linspace(0, 2 * np.pi, 30)
    U, V = np.meshgrid(u, v)
    X = (R + r * np.cos(V)) * np.cos(U)
    Y = (R + r * np.cos(V)) * np.sin(U)
    Z = r * np.sin(V)
    ax.plot_surface(X, Y, Z, color=color, alpha=alpha, edgecolor='none')

LEO_R, LEO_r = 3, 0.3
MEO_R, MEO_r = 6, 1.5
GEO_R, GEO_r = 9, 1.5

# Draw filled transparent spheres for LEO, MEO, GEO boundaries
def plot_orbit_boundary(ax, radius, color, alpha):
    u, v = np.mgrid[0:2 * np.pi:40j, 0:np.pi:20j]
    xs = radius * np.cos(u) * np.sin(v)
    ys = radius * np.sin(u) * np.sin(v)
    zs = radius * np.cos(v)
    ax.plot_surface(xs, ys, zs, color=color, alpha=alpha, edgecolor='none')

plot_orbit_boundary(ax, LEO_R + LEO_r, 'red', 0.08)
plot_orbit_boundary(ax, MEO_R + MEO_r, 'orange', 0.08)
plot_orbit_boundary(ax, GEO_R + GEO_r, 'deepskyblue', 0.08)  # Changed color for GEO

def debris_ring_points(R, r, n):
    theta = np.random.uniform(0, 2*np.pi, n)
    phi = np.random.uniform(0, 2*np.pi, n)
    x = (R + r * np.cos(phi)) * np.cos(theta)
    y = (R + r * np.cos(phi)) * np.sin(theta)
    z = r * np.sin(phi)
    return x, y, z, theta, phi

NUM_DEBRIS = 5
leo_x, leo_y, leo_z, leo_theta, leo_phi = debris_ring_points(LEO_R, LEO_r, NUM_DEBRIS)
meo_x, meo_y, meo_z, meo_theta, meo_phi = debris_ring_points(MEO_R, MEO_r, NUM_DEBRIS)
geo_x, geo_y, geo_z, geo_theta, geo_phi = debris_ring_points(GEO_R, GEO_r, NUM_DEBRIS)

leo_debris = [{"theta": t, "phi": p, "captured": False} for t, p in zip(leo_theta, leo_phi)]
meo_debris = [{"theta": t, "phi": p, "captured": False} for t, p in zip(meo_theta, meo_phi)]
geo_debris = [{"theta": t, "phi": p, "captured": False} for t, p in zip(geo_theta, geo_phi)]

leo_objs = [ax.plot([x],[y],[z],'o',color='red',markersize=5)[0] for x,y,z in zip(leo_x,leo_y,leo_z)]
meo_objs = [ax.plot([x],[y],[z],'o',color='orange',markersize=5)[0] for x,y,z in zip(meo_x,meo_y,meo_z)]
geo_objs = [ax.plot([x],[y],[z],'o',color='deepskyblue',markersize=5)[0] for x,y,z in zip(geo_x,geo_y,geo_z)]

leo_speeds = np.random.uniform(0.035, 0.065, NUM_DEBRIS)
meo_speeds = np.random.uniform(0.02, 0.04, NUM_DEBRIS)
geo_speeds = np.random.uniform(0.01, 0.02, NUM_DEBRIS)

# Satellite speeds for each orbit
SAT_SPEED_LEO = 0.05
SAT_SPEED_MEO = 0.03
SAT_SPEED_GEO = 0.01

# Satellite objects for each orbit, with different colors
satellite_leo, = ax.plot([], [], [], 'o', color='cyan', markersize=10)
satellite_meo, = ax.plot([], [], [], 'o', color='lime', markersize=10)
satellite_geo, = ax.plot([], [], [], 'o', color='magenta', markersize=10)

CAPTURE_RADIUS = 0.7  # adjust as needed

def update(frame):
    # Animate LEO debris
    for i in range(NUM_DEBRIS):
        if leo_debris[i]["captured"]:
            leo_objs[i].set_data([], [])
            leo_objs[i].set_3d_properties([])
            continue
        leo_debris[i]["theta"] += leo_speeds[i]
        t = leo_debris[i]["theta"]
        p = leo_debris[i]["phi"]
        x = (LEO_R + LEO_r * np.cos(p)) * np.cos(t)
        y = (LEO_R + LEO_r * np.cos(p)) * np.sin(t)
        z = LEO_r * np.sin(p)
        leo_objs[i].set_data([x], [y])
        leo_objs[i].set_3d_properties([z])
        leo_debris[i]["pos"] = (x, y, z)

    # Animate MEO debris
    for i in range(NUM_DEBRIS):
        if meo_debris[i]["captured"]:
            meo_objs[i].set_data([], [])
            meo_objs[i].set_3d_properties([])
            continue
        meo_debris[i]["theta"] += meo_speeds[i]
        t = meo_debris[i]["theta"]
        p = meo_debris[i]["phi"]
        x = (MEO_R + MEO_r * np.cos(p)) * np.cos(t)
        y = (MEO_R + MEO_r * np.cos(p)) * np.sin(t)
        z = MEO_r * np.sin(p)
        meo_objs[i].set_data([x], [y])
        meo_objs[i].set_3d_properties([z])
        meo_debris[i]["pos"] = (x, y, z)

    # Animate GEO debris
    for i in range(NUM_DEBRIS):
        if geo_debris[i]["captured"]:
            geo_objs[i].set_data([], [])
            geo_objs[i].set_3d_properties([])
            continue
        geo_debris[i]["theta"] += geo_speeds[i]
        t = geo_debris[i]["theta"]
        p = geo_debris[i]["phi"]
        x = (GEO_R + GEO_r * np.cos(p)) * np.cos(t)
        y = (GEO_R + GEO_r * np.cos(p)) * np.sin(t)
        z = GEO_r * np.sin(p)
        geo_objs[i].set_data([x], [y])
        geo_objs[i].set_3d_properties([z])
        geo_debris[i]["pos"] = (x, y, z)

    # Satellite motion in LEO (move in torus, like debris)
    sat_angle_leo = SAT_SPEED_LEO * frame
    sat_phi_leo = 0  # You can animate this too for more realism
    sx_leo = (LEO_R + LEO_r * np.cos(sat_phi_leo)) * np.cos(sat_angle_leo)
    sy_leo = (LEO_R + LEO_r * np.cos(sat_phi_leo)) * np.sin(sat_angle_leo)
    sz_leo = LEO_r * np.sin(sat_phi_leo)
    satellite_leo.set_data([sx_leo], [sy_leo])
    satellite_leo.set_3d_properties([sz_leo])

    # Satellite motion in MEO (move in torus, like debris)
    sat_angle_meo = SAT_SPEED_MEO * frame
    sat_phi_meo = 0
    sx_meo = (MEO_R + MEO_r * np.cos(sat_phi_meo)) * np.cos(sat_angle_meo)
    sy_meo = (MEO_R + MEO_r * np.cos(sat_phi_meo)) * np.sin(sat_angle_meo)
    sz_meo = MEO_r * np.sin(sat_phi_meo)
    satellite_meo.set_data([sx_meo], [sy_meo])
    satellite_meo.set_3d_properties([sz_meo])

    # Satellite motion in GEO (move in torus, like debris)
    sat_angle_geo = SAT_SPEED_GEO * frame
    sat_phi_geo = 0
    sx_geo = (GEO_R + GEO_r * np.cos(sat_phi_geo)) * np.cos(sat_angle_geo)
    sy_geo = (GEO_R + GEO_r * np.cos(sat_phi_geo)) * np.sin(sat_angle_geo)
    sz_geo = GEO_r * np.sin(sat_phi_geo)
    satellite_geo.set_data([sx_geo], [sy_geo])
    satellite_geo.set_3d_properties([sz_geo])

    # Capture check for LEO debris
    for i in range(NUM_DEBRIS):
        if leo_debris[i].get("captured"):
            continue
        debris_pos = leo_debris[i].get("pos")
        if debris_pos is not None:
            dx = debris_pos[0] - sx_leo
            dy = debris_pos[1] - sy_leo
            dz = debris_pos[2] - sz_leo
            dist = np.sqrt(dx*dx + dy*dy + dz*dz)
            if dist < CAPTURE_RADIUS:
                leo_debris[i]["captured"] = True
                leo_objs[i].set_data([], [])
                leo_objs[i].set_3d_properties([])

    # Capture check for MEO debris
    for i in range(NUM_DEBRIS):
        if meo_debris[i].get("captured"):
            continue
        debris_pos = meo_debris[i].get("pos")
        if debris_pos is not None:
            dx = debris_pos[0] - sx_meo
            dy = debris_pos[1] - sy_meo
            dz = debris_pos[2] - sz_meo
            dist = np.sqrt(dx*dx + dy*dy + dz*dz)
            if dist < CAPTURE_RADIUS:
                meo_debris[i]["captured"] = True
                meo_objs[i].set_data([], [])
                meo_objs[i].set_3d_properties([])

    # Capture check for GEO debris
    for i in range(NUM_DEBRIS):
        if geo_debris[i].get("captured"):
            continue
        debris_pos = geo_debris[i].get("pos")
        if debris_pos is not None:
            dx = debris_pos[0] - sx_geo
            dy = debris_pos[1] - sy_geo
            dz = debris_pos[2] - sz_geo
            dist = np.sqrt(dx*dx + dy*dy + dz*dz)
            if dist < CAPTURE_RADIUS:
                geo_debris[i]["captured"] = True
                geo_objs[i].set_data([], [])
                geo_objs[i].set_3d_properties([])

    return leo_objs + meo_objs + geo_objs + [satellite_leo, satellite_meo, satellite_geo]

legend_patches = [
    mpatches.Patch(color='blue', label='Earth'),
    mpatches.Patch(color='red', label='LEO Debris'),
    mpatches.Patch(color='orange', label='MEO Debris'),
    mpatches.Patch(color='deepskyblue', label='GEO Debris'),  # Changed color for GEO
    mpatches.Patch(color='cyan', label='LEO Satellite'),
    mpatches.Patch(color='lime', label='MEO Satellite'),
    mpatches.Patch(color='magenta', label='GEO Satellite'),
]
ax.legend(handles=legend_patches, loc='upper left', fontsize=8, facecolor='white', edgecolor='white')

ani = animation.FuncAnimation(fig, update, frames=1000, interval=30, blit=True)
plt.show()