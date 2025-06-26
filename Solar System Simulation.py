import numpy as np
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D
from matplotlib import animation
import matplotlib.patches as mpatches
import datetime

# Planetary data: name, color, orbital radius (AU), orbital period (years), inclination (deg), axial tilt (deg)
planets = [
    ("Sun", "yellow", 0, 1, 0, 7.25),
    ("Mercury", "brown", 0.39, 0.24, 7.0, 0.03),
    ("Venus", "orange", 0.72, 0.62, 3.4, 177.4),
    ("Earth", "blue", 1.00, 1.00, 0.0, 23.4),
    ("Mars", "red", 1.52, 1.88, 1.85, 25.2),
    ("Jupiter", "goldenrod", 5.20, 11.86, 1.3, 3.1),
    ("Saturn", "gold", 9.58, 29.46, 2.5, 26.7),
    ("Uranus", "lightblue", 19.18, 84.01, 0.8, 97.8),
    ("Neptune", "darkblue", 30.07, 164.8, 1.8, 28.3),
]

# Custom scale factors for orbital radii to spread out inner planets more visually
radius_scale_factors = {
    "Sun": 0,
    "Mercury": 5,
    "Venus": 9,
    "Earth": 13,
    "Mars": 18,
    "Jupiter": 26,
    "Saturn": 32,
    "Uranus": 38,
    "Neptune": 44,
}

# Simulation parameters
sim_speed = 1  # speed multiplier
sim_time = 0

# Setup figure and 3D axis
fig = plt.figure(figsize=(10, 8))
ax = fig.add_subplot(111, projection='3d')
ax.set_facecolor("black")
fig.patch.set_facecolor('black')

ax.set_xlim([-50, 50])
ax.set_ylim([-50, 50])
ax.set_zlim([-10, 10])

ax.set_title("3D Solar System Simulator", color='white')

# Style the panes and ticks to be visible and white
ax.xaxis.pane.set_edgecolor('white')
ax.yaxis.pane.set_edgecolor('white')
ax.zaxis.pane.set_edgecolor('white')
ax.tick_params(colors='white')

legend_handles = [mpatches.Patch(color=p[1], label=p[0]) for p in planets]
leg = ax.legend(handles=legend_handles, loc='upper left', bbox_to_anchor=(1.05, 1), facecolor='black', edgecolor='white')

# Set legend text color to white
for text in leg.get_texts():
    text.set_color('white')

# Prepare plot elements for planets, trails, orbit lines
planet_objs = []
trail_objs = []
trail_history = [[] for _ in planets]
orbit_lines = []

for name, color, radius, period, incl, tilt in planets:
    orbit_line, = ax.plot([], [], [], color=color, lw=0.5, alpha=0.4)
    orbit_lines.append(orbit_line)
    marker_size = 10 if name == "Sun" else 6
    planet_obj, = ax.plot([], [], [], 'o', color=color, markersize=marker_size, picker=5)
    planet_objs.append(planet_obj)
    trail_obj, = ax.plot([], [], [], color=color, lw=1)
    trail_objs.append(trail_obj)

# Text display for clicked planet
picked_text = ax.text2D(0.05, 0.95, "", transform=ax.transAxes, color='white')

def on_pick(event):
    for i, artist in enumerate(planet_objs):
        if event.artist == artist:
            picked_text.set_text(f"Selected: {planets[i][0]}")
            break
fig.canvas.mpl_connect('pick_event', on_pick)

# Update function for animation
def update(frame):
    global sim_time
    sim_time += 0.002 * sim_speed

    for i, (name, color, radius, period, incl, tilt) in enumerate(planets):
        scaled_radius = radius_scale_factors[name]

        angle = 2 * np.pi * sim_time / period if period != 0 else 0
        incl_rad = np.radians(incl)
        tilt_rad = np.radians(tilt)

        # Calculate 3D position with orbital inclination
        x = scaled_radius * np.cos(angle)
        y = scaled_radius * np.sin(angle) * np.cos(incl_rad)
        z = scaled_radius * np.sin(angle) * np.sin(incl_rad)

        # Small axial tilt effect on z-axis for visualization
        z += 0.1 * np.sin(tilt_rad)

        # Update planet position
        planet_objs[i].set_data([x], [y])
        planet_objs[i].set_3d_properties([z])

        # Update trail history (max length 200)
        trail_history[i].append((x, y, z))
        trail_np = np.array(trail_history[i][-200:])
        trail_objs[i].set_data(trail_np[:, 0], trail_np[:, 1])
        trail_objs[i].set_3d_properties(trail_np[:, 2])

        # Update orbit line
        theta = np.linspace(0, 2 * np.pi, 200)
        ox = scaled_radius * np.cos(theta)
        oy = scaled_radius * np.sin(theta) * np.cos(incl_rad)
        oz = scaled_radius * np.sin(theta) * np.sin(incl_rad)
        orbit_lines[i].set_data(ox, oy)
        orbit_lines[i].set_3d_properties(oz)

    return planet_objs + trail_objs + orbit_lines + [picked_text]

# Keyboard controls for speed and pause/play
def on_key(event):
    global sim_speed
    if event.key == 'up':
        sim_speed *= 1.2
    elif event.key == 'down':
        sim_speed /= 1.2
    elif event.key == ' ':
        if ani.event_source.running:
            ani.event_source.stop()
        else:
            ani.event_source.start()

fig.canvas.mpl_connect('key_press_event', on_key)

# Run animation
ani = animation.FuncAnimation(fig, update, frames=1000, interval=20, blit=True)
plt.show()