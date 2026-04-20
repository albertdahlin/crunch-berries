// @ts-check
// Shared JSDoc typedefs. No runtime code.

/**
 * @typedef {Object} DotDef
 * @property {number} dps
 * @property {number} duration        Frames of DOT duration
 */

/**
 * @typedef {Object} TowerDef
 * @property {string}      [name]
 * @property {string}      [letter]
 * @property {string}      [color]
 * @property {string}      [bg]
 * @property {number}      [range]
 * @property {number}      [damage]
 * @property {number}      [fireRate]        Frames between shots
 * @property {number}      [cost]
 * @property {number}      [hp]
 * @property {string}      [damageType]      'physical'|'fire'|'ice'|'lightning'|'poison'
 * @property {string}      [desc]
 * @property {number}      [splashRadius]
 * @property {number}      [projectileSpeed] Tiles per frame
 * @property {boolean}     [pierce]
 * @property {'any'|'fixed'} [attackDir]
 * @property {number}      [speedFactor]
 * @property {number}      [speedDuration]
 * @property {number}      [goldSteal]
 * @property {DotDef|false}  [dot]
 * @property {number}      [sizeW]
 * @property {number}      [sizeH]
 * @property {TowerDef[]}  [upgrades]
 */

/**
 * @typedef {Object<string, number>} DamageModifiers
 */

/**
 * @typedef {Object} MonsterDef
 * @property {string} name
 * @property {string} letter
 * @property {string} color
 * @property {number} hp
 * @property {number} speed                 Tiles per frame
 * @property {number} reward
 * @property {string} [desc]
 * @property {DamageModifiers} [damageModifiers]
 */

/**
 * @typedef {Object} WaveConfig
 * @property {number[]} baseCounts
 * @property {number[]} unlockWave
 * @property {number[]} [unlockTower]
 * @property {number}   scaleEvery
 * @property {number}   hpScale          Percent per wave
 * @property {number}   intervalStart    Frames
 * @property {number}   intervalDecay    Frames
 * @property {number}   intervalMin      Frames
 * @property {Array<{wave:number, lore?:string, bonus?:number, monsters?:Object}>} [script]
 */

/**
 * @typedef {Object} GameSettings
 * @property {number} startGold
 * @property {number} startLives
 * @property {number} waveBonusGold
 * @property {number} sellRefundPercent
 */

/**
 * @typedef {Object} Campaign
 * @property {string}        id
 * @property {string}        name
 * @property {boolean}       builtin
 * @property {TowerDef[]}    towers
 * @property {MonsterDef[]}  monsters
 * @property {WaveConfig}    waves
 * @property {GameSettings}  game
 */

/**
 * @typedef {Object} MapDef
 * @property {string}   id
 * @property {string}   name
 * @property {number}   cols
 * @property {number}   rows
 * @property {number[]} data
 */

/**
 * @typedef {Object} Cursor
 * @property {number}  x
 * @property {number}  y
 * @property {boolean} visible
 */

/**
 * @typedef {Object} Tower
 * @property {number}    x
 * @property {number}    y
 * @property {number}    typeIdx
 * @property {number}    rotation
 * @property {number}    hp
 * @property {number}    maxHp
 * @property {number}    lastFire
 * @property {number}    placedAtWave
 * @property {number[]}  upgradePath
 * @property {number}    totalCost
 * @property {number}    [kills]
 * @property {number}    [damageDealt]
 * @property {number}    [goldStolen]
 */

/**
 * @typedef {Object} Monster
 * @property {number} x
 * @property {number} y
 * @property {number} hp
 * @property {number} maxHp
 * @property {number} speed
 * @property {number} typeIdx
 * @property {number} reward
 * @property {string} letter
 * @property {string} color
 * @property {?Tower} attacking
 * @property {?{dps:number,remaining:number,damageType:string}} dot
 * @property {?{factor:number,remaining:number}} speedMod
 * @property {number} renderScale
 */

/**
 * @typedef {Object} Projectile
 * @property {number}   x
 * @property {number}   y
 * @property {number}   tx
 * @property {number}   ty
 * @property {number}   vx
 * @property {number}   vy
 * @property {number}   damage
 * @property {TowerDef} towerNode
 * @property {Tower}    tower
 * @property {string}   color
 */

/**
 * @typedef {Object} Effect
 * @property {string}  [type]   'circle' or undefined for line
 * @property {number}  x
 * @property {number}  y
 * @property {number}  [tx]
 * @property {number}  [ty]
 * @property {number}  [radius]
 * @property {number}  ttl
 * @property {string}  color
 * @property {boolean} [wide]
 */

/** @typedef {'PLACE'|'WAVE'|'GAMEOVER'} GamePhase */

/**
 * @typedef {Object} GameState
 * @property {Tower[]}      towers
 * @property {Monster[]}    monsters
 * @property {Effect[]}     effects
 * @property {Projectile[]} projectiles
 * @property {Cursor}       cursor
 * @property {number}       selectedTower
 * @property {number}       placeRotation
 * @property {number}       wave
 * @property {number}       lives
 * @property {number}       gold
 * @property {number}       score
 * @property {number}       frame
 * @property {GamePhase}    phase
 * @property {string}       message
 * @property {number}       messageTimer
 * @property {?Tower}       selectedPlacedTower
 */

/**
 * @typedef {Object} MapRuntime
 * Ground + grid + pathing arrays for the currently loaded map. Owned by the Game;
 * handed to the Renderer via Renderer.renderGame as part of the frame payload.
 * @property {number}     cols
 * @property {number}     rows
 * @property {Uint8Array} ground
 * @property {Uint8Array} grid
 * @property {?Int32Array} pathDist
 * @property {?Int8Array}  pathFlow
 */

/**
 * @typedef {Object} EditorOverlay
 * @property {number}  brush
 * @property {number}  brushSize
 */

/**
 * @typedef {Object} Renderer
 * @property {(state: GameState, map: MapRuntime, campaign: Campaign) => void} renderGame
 * @property {(map: MapRuntime, cursor: Cursor, overlay: EditorOverlay) => void} renderEditor
 * @property {() => void} resize
 * @property {(clientX: number, clientY: number) => {x: number, y: number, px: number, py: number}} clientToTile
 * @property {() => {tile: number, canvasW: number, canvasH: number}} getDimensions
 * @property {() => void} clear
 * @property {(cols: number, rows: number) => void} setGridSize
 */

/**
 * @typedef {Object} HudHandlers
 * @property {() => void}        onStartWave
 * @property {() => void}        onRotate
 * @property {() => void}        onSell
 * @property {() => void}        onPlace
 * @property {() => void}        onBestiary
 * @property {() => void}        onSave
 * @property {() => void}        onQuit
 * @property {(i: number) => void} onSelectTowerType
 * @property {(i: number) => void} onUpgrade
 * @property {(node: TowerDef) => void} onHoverUpgrade
 * @property {() => void} onLeaveUpgrade
 */

/**
 * @typedef {Object} Hud
 * @property {() => void} show
 * @property {() => void} hide
 * @property {(state: GameState, campaign: Campaign) => void} update
 * @property {(state: GameState, campaign: Campaign) => void} rebuildTowerButtons
 * @property {(state: GameState, campaign: Campaign) => void} refreshSelection
 * @property {(msg: string) => void} flash
 * @property {(handlers: HudHandlers) => void} bind
 */

/**
 * @typedef {Object} GameInput
 * @property {(clientX: number, clientY: number) => void} onPointerMove
 * @property {() => void} onPointerLeave
 * @property {(clientX: number, clientY: number) => void} onPointerDown
 * @property {(clientX: number, clientY: number, wasDrag: boolean) => void} onPointerTap
 * @property {(key: string) => boolean} onKey
 */

/**
 * @typedef {Object} Game
 * @property {GameState}    state
 * @property {Campaign}     campaign
 * @property {MapRuntime}   mapRuntime
 * @property {MapDef}       mapDef
 * @property {GameInput}    input
 * @property {() => void}   start
 * @property {() => void}   stop
 * @property {() => Object} serialize
 * @property {(snapshot: Object) => void} restore
 */

/**
 * @typedef {Object} SavedGame
 * @property {string} id
 * @property {string} name
 * @property {string} campaignId
 * @property {MapDef} map
 * @property {Object} snapshot
 * @property {string} savedAt
 */

/** @typedef {'canvas'|'webgl'} RendererType */

/**
 * @typedef {Object} AppSettings
 * @property {RendererType} rendererType
 */

export {};
