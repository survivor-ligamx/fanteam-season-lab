function nrm(s){return (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'')}
function editorialProjectionFactor(player,gameweek){return FanTeamEditorial.projectionFactor(SYNC.editorialSignals?.signals,player,gameweek,editorialContext(gameweek))}
function autoDraftCoreHorizon6(player,gameweek){return autoDraftRawHorizon6(player,gameweek)-lowCeilingHorizonPenalty(player,gameweek,FanTeamProjection.SIX_WEEK_WEIGHTS)}
