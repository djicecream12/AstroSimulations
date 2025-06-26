import numpy as np
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation

fig = plt.figure(figsize=(10, 8))
ax = fig.add_subplot(111, projection='3d')
fig.patch.set_facecolor('black')
ax.set_facecolor('black')

# Stars
num_stars = 300
star_x = np.random.uniform(-45000, 45000, num_stars)
star_y = np.random.uniform(-45000, 45000, num_stars)
star_z = np.random.uniform(-45000, 45000, num_stars)
ax.scatter(star_x, star_y, star_z, color='white', s=1)

# Earth
earth_radius = 6371
u = np.linspace(0, 2 * np.pi, 100)
v = np.linspace(0, np.pi, 100)
x_earth = earth_radius * np.outer(np.cos(u), np.sin(v))
y_earth = earth_radius * np.outer(np.sin(u), np.sin(v))
z_earth = earth_radius * np.outer(np.ones(np.size(u)), np.cos(v))
ax.plot_surface(x_earth, y_earth, z_earth, color='blue', alpha=0.6)

# Orbit definitions with inclination
orbits = [
    {"name": "LEO", "a": 6771, "e": 0.01, "inclination": 51.6, "color": "red"},
    {"name": "MEO", "a": 20200, "e": 0.02, "inclination": 55.0, "color": "orange"}, 
    {"name": "GEO", "a": 42164, "e": 0.0, "inclination": 0.0, "color": "green"},
]

theta = np.linspace(0, 2 * np.pi, 1000)

def rotate_x(x, y, z, angle_deg):
    angle_rad = np.radians(angle_deg)
    y_rot = y * np.cos(angle_rad) - z * np.sin(angle_rad)
    z_rot = y * np.sin(angle_rad) + z * np.cos(angle_rad)
    return x, y_rot, z_rot

orbit_points = []

for orbit in orbits:
    a = orbit["a"]
    e = orbit["e"]
    r = (a * (1 - e**2)) / (1 + e * np.cos(theta))
    x = r * np.cos(theta) - a * e
    y = r * np.sin(theta)
    z = np.zeros_like(x)
    x, y, z = rotate_x(x, y, z, orbit["inclination"])
    orbit_points.append((x, y, z))
    ax.plot3D(x, y, z, color=orbit["color"], label=orbit["name"])

max_radius = 45000
ax.set_xlim([-max_radius, max_radius])
ax.set_ylim([-max_radius, max_radius])
ax.set_zlim([-max_radius, max_radius])

ax.set_xlabel("X (km)")
ax.set_ylabel("Y (km)")
ax.set_zlabel("Z (km)")
ax.set_title("3D Orbits of Satellites")
ax.xaxis.label.set_color('white')
ax.yaxis.label.set_color('white')
ax.zaxis.label.set_color('white')
ax.title.set_color('white')
ax.tick_params(colors='white')
legend = ax.legend()
legend.get_frame().set_facecolor('black')
legend.get_frame().set_edgecolor('white')
for text in legend.get_texts():
    text.set_color('white')

# Satellites and trails
satellites = []
trails = []
trail_length = 50  # how long the tail is

for i, (x, y, z) in enumerate(orbit_points):
    sat, = ax.plot([x[0]], [y[0]], [z[0]], marker='o', markersize=6, color=orbits[i]["color"])
    satellites.append(sat)
    # Initialize trail line with empty data
    trail_line, = ax.plot([], [], [], color=orbits[i]["color"], alpha=0.5, linewidth=1)
    trails.append(trail_line)

# Store previous points for trails
positions_history = [ [] for _ in orbits ]

def update(frame):
    for i, (x, y, z) in enumerate(orbit_points):
        idx = (frame * 5) % len(x)  # speed multiplier
        # Update satellite position
        satellites[i].set_data([x[idx]], [y[idx]])
        satellites[i].set_3d_properties([z[idx]])
        
        # Update trail history
        positions_history[i].append((x[idx], y[idx], z[idx]))
        if len(positions_history[i]) > trail_length:
            positions_history[i].pop(0)

        # Unpack trail positions
        trail_x, trail_y, trail_z = zip(*positions_history[i])
        trails[i].set_data(trail_x, trail_y)
        trails[i].set_3d_properties(trail_z)

        # Optional: fade trail alpha by length (simple linear fade)
        alphas = np.linspace(0.1, 0.5, len(trail_x))
        # matplotlib 3D lines do not support per-point alpha easily, so we keep fixed alpha for now
        
    return satellites + trails

ani = FuncAnimation(fig, update, frames=len(theta), interval=10, blit=False)
plt.show()